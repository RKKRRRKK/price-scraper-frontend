"""Body composition from weight + impedance for the Mi Body Composition Scale 2.

Ported from openScale's MiScaleLib.kt (itself from prototux/MIBCS-reverse-engineering) and
BodyMiScaleLib.kt (visceral fat and BMR). The scale only reports weight and one impedance
value; everything here is Xiaomi's regression on top of those plus height, age and sex.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

# A plausible adult body is a few hundred ohms; outside this the reading is a bad contact.
IMPEDANCE_RANGE = (50, 3000)


def age_on(birth: date, day: date) -> int:
    """Whole years of age on `day`."""
    return day.year - birth.year - ((day.month, day.day) < (birth.month, birth.day))


class MiScaleLib:
    """Direct port of openScale's MiScaleLib. `sex`: 1 male, 0 female; `height` in cm."""

    def __init__(self, sex: int, age: int, height: float):
        self.sex, self.age, self.height = sex, age, height

    def _lbm_coefficient(self, weight: float, impedance: float) -> float:
        lbm = (self.height * 9.058 / 100.0) * (self.height / 100.0)
        lbm += weight * 0.32 + 12.226
        lbm -= impedance * 0.0068
        lbm -= self.age * 0.0542
        return lbm

    def bmi(self, weight: float) -> float:
        return weight / (((self.height * self.height) / 100.0) / 100.0)

    def lbm(self, weight: float, impedance: float) -> float:
        lbm = weight - (self.body_fat(weight, impedance) * 0.01 * weight) - self.bone_mass(weight, impedance)
        if (self.sex == 0 and lbm >= 84.0) or (self.sex == 1 and lbm >= 93.5):
            lbm = 120.0
        return lbm

    def skeletal_muscle_pct(self, weight: float, impedance: float) -> float:
        """openScale's current 'muscle': Janssen BIA skeletal muscle, % of weight, clamped 10..60."""
        if weight <= 0:
            return 0.0
        if impedance > 0:
            smm = 0.401 * (self.height * self.height) / impedance + 3.825 * self.sex - 0.071 * self.age + 5.102
        else:
            smm = self.lbm(weight, impedance) * (0.52 if self.sex == 1 else 0.46)
        return min(60.0, max(10.0, smm / weight * 100.0))

    def water(self, weight: float, impedance: float) -> float:
        water = (100.0 - self.body_fat(weight, impedance)) * 0.7
        return (1.02 if water < 50.0 else 0.98) * water

    def bone_mass(self, weight: float, impedance: float) -> float:
        base = 0.245691014 if self.sex == 0 else 0.18016894
        bone = (base - self._lbm_coefficient(weight, impedance) * 0.05158) * -1.0
        bone = bone + 0.1 if bone > 2.2 else bone - 0.1
        if (self.sex == 0 and bone > 5.1) or (self.sex == 1 and bone > 5.2):
            bone = 8.0
        return bone

    def visceral_fat(self, weight: float) -> float:
        """openScale's MiScaleLib version. Its female low-weight branch is wrong (-36 in its own
        tests); [visceral_fat_zepp] is what [compose] uses."""
        h, age = self.height, self.age
        if self.sex == 0:
            if weight > (13.0 - h * 0.5) * -1.0:
                sub = ((h * 1.45) + (h * 0.1158) * h) - 120.0
                return (weight * 500.0 / sub - 6.0) + age * 0.07
            sub = 0.691 + h * -0.0024 + h * -0.0024
            return ((h * 0.027 - sub * weight) * -1.0) + age * 0.07 - age
        if h < weight * 1.6:
            sub = ((h * 0.4) - (h * (h * 0.0826))) * -1.0
            return (weight * 305.0 / (sub + 48.0)) - 2.9 + age * 0.15
        sub = 0.765 + h * -0.0015
        return ((h * 0.143 - weight * sub) * -1.0) + age * 0.15 - 5.0

    def visceral_fat_zepp(self, weight: float) -> float:
        """Zepp Life formula from openScale's BodyMiScaleLib (bodymiscale), clamped to 1..50, rounded down as Zepp shows it."""
        return float(math.floor(self._visceral_fat_zepp_raw(weight)))

    def _visceral_fat_zepp_raw(self, weight: float) -> float:
        h, w, age = self.height, weight, self.age
        if self.sex == 1:
            if h < w * 1.6 + 63.0:
                v = age * 0.15 + ((w * 305.0) / ((h * 0.0826 * h - h * 0.4) + 48.0) - 2.9)
            else:
                v = age * 0.15 + (w * (h * -0.0015 + 0.765) - h * 0.143) - 5.0
        else:
            if w <= h * 0.5 - 13.0:
                v = age * 0.07 + (w * (h * -0.0024 + 0.691) - h * 0.027) - 10.5
            else:
                v = age * 0.07 + ((w * 500.0) / ((h * 1.45 + h * 0.1158 * h) - 120.0) - 6.0)
        return min(50.0, max(1.0, v))

    def body_fat(self, weight: float, impedance: float) -> float:
        lbm_sub = 0.8
        if self.sex == 0 and self.age <= 49:
            lbm_sub = 9.25
        elif self.sex == 0:
            lbm_sub = 7.25
        coeff = 1.0
        if self.sex == 1 and weight < 61.0:
            coeff = 0.98
        elif self.sex == 0 and weight > 60.0:
            coeff = 0.96 * (1.03 if self.height > 160.0 else 1.0)
        elif self.sex == 0 and weight < 50.0:
            coeff = 1.02 * (1.03 if self.height > 160.0 else 1.0)
        fat = (1.0 - (((self._lbm_coefficient(weight, impedance) - lbm_sub) * coeff) / weight)) * 100.0
        return 75.0 if fat > 63.0 else fat

    def bmr(self, weight: float) -> float:
        """Xiaomi's BMR (MIBCS), kcal/day, clamped 500..10000; matches the user's Zepp Life export to 2 kcal."""
        if self.sex == 1:
            bmr = 877.8 + weight * 14.916 - self.height * 0.726 - self.age * 8.976
        else:
            bmr = 864.6 + weight * 10.2036 - self.height * 0.39336 - self.age * 6.204
        return min(10000.0, max(500.0, bmr))


@dataclass(frozen=True)
class Composition:
    """What the scale reports. Impedance-derived fields are None without a usable impedance."""
    bmi: float
    bmr_kcal: float
    visceral_fat: float
    body_fat_pct: float | None = None
    water_pct: float | None = None
    bone_kg: float | None = None
    muscle_kg: float | None = None  # weight - fat - bone, the Mi Fit / Zepp Life "muscle mass"


def impedance_usable(impedance: int | None) -> bool:
    return impedance is not None and IMPEDANCE_RANGE[0] <= impedance <= IMPEDANCE_RANGE[1]


def compose(weight_kg: float, impedance: int | None, height_cm: float, age: int, sex: str) -> Composition:
    """`sex` is "male" or "female"."""
    lib = MiScaleLib(1 if sex.lower().startswith("m") else 0, age, height_cm)
    out = dict(bmi=lib.bmi(weight_kg), bmr_kcal=lib.bmr(weight_kg), visceral_fat=lib.visceral_fat_zepp(weight_kg))
    if impedance_usable(impedance):
        fat = lib.body_fat(weight_kg, impedance)
        bone = lib.bone_mass(weight_kg, impedance)
        out.update(body_fat_pct=fat, water_pct=lib.water(weight_kg, impedance), bone_kg=bone,
                   muscle_kg=weight_kg - fat * 0.01 * weight_kg - bone)
    return Composition(**out)
