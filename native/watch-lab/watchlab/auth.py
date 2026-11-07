"""Xiaomi auth handshake and packet crypto. Ported from Gadgetbridge's XiaomiAuthService.java.

Handshake (all on command type 1):
  1. phone -> watch  subtype 26  AppVerify(nonce = 16 random bytes)
  2. watch -> phone  subtype 26  DeviceVerify(nonce, hmac)
  3. phone -> watch  subtype 27  AppConfirm(encryptedNonces, encryptedDeviceInfo)
  4. watch -> phone  subtype 27  status; from here on traffic is encrypted

Key derivation: HKDF-like expansion of HMAC-SHA256 keyed with HMAC(phone_nonce||watch_nonce, secret)
over "miwear-auth", 64 bytes -> decryption key, encryption key, decryption nonce, encryption nonce.
V1 packets use AES-CCM (4-byte tag) with a per-packet counter nonce; V2 packets use AES-CTR with the
key doubling as the IV (every packet restarts the same keystream, as in the official app).
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import struct
from typing import Optional

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESCCM

from .proto import xiaomi_pb2
from .proto.xiaomi import wear_account_pb2

log = logging.getLogger("watchlab.auth")

COMMAND_TYPE = 1
CMD_SEND_USERID = 5
CMD_NONCE = 26
CMD_AUTH = 27

TAG_SIZE = 4  # GB encrypts with a 32-bit MAC


class AuthError(Exception):
    pass


def hmac_sha256(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha256).digest()


def compute_auth_step3_hmac(secret_key: bytes, phone_nonce: bytes, watch_nonce: bytes) -> bytes:
    """64 bytes: decryptionKey[16] | encryptionKey[16] | decryptionNonce[4] | encryptionNonce[4] | ..."""
    key = hmac_sha256(phone_nonce + watch_nonce, secret_key)
    out = b""
    tmp = b""
    b = 1
    while len(out) < 64:
        tmp = hmac_sha256(key, tmp + b"miwear-auth" + bytes([b]))
        out += tmp
        b += 1
    return out[:64]


def ccm_encrypt(key: bytes, nonce: bytes, payload: bytes) -> bytes:
    """AES-CCM, 4-byte tag appended (BouncyCastle layout: ciphertext || tag)."""
    return AESCCM(key, tag_length=TAG_SIZE).encrypt(nonce, payload, None)


def ccm_decrypt(key: bytes, nonce: bytes, data: bytes, check_mac: bool = True) -> bytes:
    if check_mac:
        return AESCCM(key, tag_length=TAG_SIZE).decrypt(nonce, data, None)
    return ccm_ctr_only(key, nonce, data[:-TAG_SIZE])


def ccm_ctr_only(key: bytes, nonce: bytes, ciphertext: bytes) -> bytes:
    """CCM payload decryption without verifying the tag (counter blocks start at 1)."""
    l_field = 15 - len(nonce)
    flags = l_field - 1
    out = bytearray()
    ecb = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    for i in range(0, len(ciphertext), 16):
        ctr = i // 16 + 1
        block = bytes([flags]) + nonce + ctr.to_bytes(l_field, "big")
        ks = ecb.update(block)
        chunk = ciphertext[i:i + 16]
        out += bytes(a ^ b for a, b in zip(chunk, ks))
    return bytes(out)


def ctr_crypt(key: bytes, iv: bytes, message: bytes) -> bytes:
    c = Cipher(algorithms.AES(key), modes.CTR(iv)).encryptor()
    return c.update(message) + c.finalize()


def build_nonce_command(nonce: bytes, device_id: Optional[str] = None) -> xiaomi_pb2.Command:
    app_verify = wear_account_pb2.Auth.AppVerify(nonce=nonce)
    # Wear OS watches (eg. Watch 5) need the client identity here; unset for the S5 so the wire format is unchanged.
    if device_id:
        app_verify.deviceId = device_id
    cmd = xiaomi_pb2.Command(type=COMMAND_TYPE, subtype=CMD_NONCE)
    cmd.auth.appVerify.CopyFrom(app_verify)
    return cmd


class AuthService:
    def __init__(self, secret_key: bytes, *, check_decryption_mac: bool = True,
                 phone_name: str = "watch-lab", phone_api_level: float = 34.0, region: str = "EN",
                 nonce: Optional[bytes] = None) -> None:
        if len(secret_key) != 16:
            raise ValueError("secret key must be 16 bytes")
        self._secret_key = secret_key
        self.check_decryption_mac = check_decryption_mac
        self.phone_name = phone_name
        self.phone_api_level = phone_api_level
        self.region = region
        self._fixed_nonce = nonce
        self.encryption_initialized = False
        self.nonce = b"\0" * 16
        self.encryption_key = b"\0" * 16
        self.decryption_key = b"\0" * 16
        self.encryption_nonce = b"\0" * 4
        self.decryption_nonce = b"\0" * 4

    # -- handshake -------------------------------------------------------------------------
    def start_encrypted_handshake(self, device_id: Optional[str] = None) -> xiaomi_pb2.Command:
        """Reset state and return the step-1 command (the caller sends it)."""
        self.encryption_initialized = False
        self.nonce = self._fixed_nonce or os.urandom(16)
        return build_nonce_command(self.nonce, device_id)

    def handle_watch_nonce(self, device_verify) -> Optional[xiaomi_pb2.Command]:
        """Derive keys from the watch's nonce and build step 3; None if the watch's hmac does not match (bad key)."""
        watch_nonce = bytes(device_verify.nonce)
        step2 = compute_auth_step3_hmac(self._secret_key, self.nonce, watch_nonce)
        self.decryption_key = step2[0:16]
        self.encryption_key = step2[16:32]
        self.decryption_nonce = step2[32:36]
        self.encryption_nonce = step2[36:40]

        expected = hmac_sha256(self.decryption_key, watch_nonce + self.nonce)
        if not hmac.compare_digest(expected, bytes(device_verify.hmac)):
            log.warning("watch hmac mismatch: expected %s, watch sent %s", expected.hex(), bytes(device_verify.hmac).hex())
            return None

        info = wear_account_pb2.CompanionDevice(unknown1=0, phoneApiLevel=self.phone_api_level,
                                                phoneName=self.phone_name, unknown3=224, region=self.region)
        encrypted_nonces = hmac_sha256(self.encryption_key, self.nonce + watch_nonce)
        encrypted_info = self.encrypt(info.SerializeToString(), 0)
        confirm = wear_account_pb2.Auth.AppConfirm(encryptedNonces=encrypted_nonces, encryptedDeviceInfo=encrypted_info)
        cmd = xiaomi_pb2.Command(type=COMMAND_TYPE, subtype=CMD_AUTH)
        cmd.auth.appConfirm.CopyFrom(confirm)
        return cmd

    def on_auth_response(self, cmd: xiaomi_pb2.Command) -> bool:
        """Handle the watch's reply to step 3. True once authenticated."""
        ok = cmd.subtype == CMD_AUTH or cmd.auth.status == 1
        if ok:
            self.encryption_initialized = cmd.subtype == CMD_AUTH
        return ok

    # -- V1 packet crypto ------------------------------------------------------------------
    def encrypt(self, data: bytes, counter: int) -> bytes:
        nonce = self.encryption_nonce + struct.pack("<II", 0, counter & 0xFFFFFFFF)
        return ccm_encrypt(self.encryption_key, nonce, data)

    def decrypt(self, data: bytes) -> bytes:
        nonce = self.decryption_nonce + struct.pack("<II", 0, 0)
        return ccm_decrypt(self.decryption_key, nonce, data, self.check_decryption_mac)

    # -- V2 packet crypto ------------------------------------------------------------------
    def encrypt_v2(self, message: bytes) -> bytes:
        return ctr_crypt(self.encryption_key, self.encryption_key, message)

    def decrypt_v2(self, ciphertext: bytes) -> bytes:
        return ctr_crypt(self.decryption_key, self.decryption_key, ciphertext)
