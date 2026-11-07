"""Scale decoding, final-reading detection and body composition.

The adverts are hand-built from the layout documented in watchlab/scale.py (openScale's
MiScaleHandler.parseLive13); openScale ships no advert bytes. The MiScaleLib numbers are
the regression fixtures from openScale's own MiScaleLibTest.kt.
"""
import sys
import unittest
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from watchlab import bodycomp, scale  # noqa: E402
from watchlab.scale import Advert, Reading, ReadingTracker  # noqa: E402

PROFILE = scale.Profile(177.0, date(1998, 4, 3), "male")
WHEN = datetime(2026, 11, 5, 7, 30, 15)
NOW_MS = scale.to_ms(WHEN)  # readings carry the arrival time, which matches the scale stamp here


def frame(raw_weight=15070, impedance=0, c0=0x00, c1=0x20, when=WHEN) -> bytes:
    """13-byte 0x181B service data."""
    return bytes([c0, c1, when.year & 0xFF, when.year >> 8, when.month, when.day, when.hour, when.minute,
                  when.second, impedance & 0xFF, impedance >> 8, raw_weight & 0xFF, raw_weight >> 8])


def adv(**kw) -> Advert:
    return scale.decode_advert(frame(**kw))


class DecodeTest(unittest.TestCase):
    def test_kg_stabilised_with_impedance(self):
        a = adv(c1=0x22, impedance=512)
        self.assertEqual(a.unit, "kg")
        self.assertTrue(a.stabilized and a.has_impedance and not a.removed)
        self.assertEqual(a.time, WHEN)
        self.assertEqual(a.impedance, 512)
        self.assertAlmostEqual(a.weight_kg, 75.35, places=6)

    def test_raw_bytes(self):
        self.assertEqual(frame(c1=0x22, impedance=512).hex(), "0022ea070b05071e0f0002de3a")

    def test_lb(self):
        a = adv(c0=0x01, raw_weight=16610)
        self.assertEqual(a.unit, "lb")
        self.assertAlmostEqual(a.weight_kg, 166.10 * 0.45359237, places=6)

    def test_jin(self):
        a = adv(c1=0x60, raw_weight=15070)
        self.assertEqual(a.unit, "jin")
        self.assertAlmostEqual(a.weight_kg, 75.35, places=6)

    def test_flags(self):
        self.assertFalse(adv(c1=0x00).stabilized)
        self.assertTrue(adv(c1=0xA0).removed)
        self.assertTrue(adv(c1=0x02).has_impedance)

    def test_unstable_weight_moves(self):
        self.assertAlmostEqual(adv(c1=0x00, raw_weight=15234).weight_kg, 76.17, places=6)

    def test_rejects_wrong_length_and_bad_date(self):
        with self.assertRaisesRegex(ValueError, "13 bytes"):
            scale.decode_advert(frame()[:10])
        bad = bytearray(frame())
        bad[4] = 13
        with self.assertRaisesRegex(ValueError, "bad timestamp"):
            scale.decode_advert(bytes(bad))


class TrackerTest(unittest.TestCase):
    def feed(self, tr, a, mono=0.0):
        return tr.feed(a, mono, NOW_MS)

    def test_unstable_frames_give_nothing(self):
        tr = ReadingTracker()
        self.assertEqual(self.feed(tr, adv(c1=0x00, raw_weight=14000)), [])
        self.assertEqual(self.feed(tr, adv(c1=0x00, raw_weight=15000, impedance=0)), [])

    def test_stabilised_with_impedance_is_final_once(self):
        tr = ReadingTracker()
        a = adv(c1=0x22, impedance=512)
        out = self.feed(tr, a)
        self.assertEqual(out, [Reading(scale.to_ms(WHEN), 75.35, 512)])
        self.assertEqual(self.feed(tr, a, 1.0), [])  # identical repeat
        self.assertEqual(self.feed(tr, adv(c1=0x22, impedance=512, when=datetime(2026, 11, 5, 7, 30, 16)), 2.0), [])

    def test_weight_only_after_grace(self):
        tr = ReadingTracker(grace_s=6)
        self.assertEqual(self.feed(tr, adv(c1=0x20)), [])
        self.assertEqual(tr.poll(5.9), [])
        self.assertEqual(tr.poll(6.0), [Reading(scale.to_ms(WHEN), 75.35, None)])
        self.assertEqual(tr.poll(20.0), [])

    def test_impedance_before_grace_wins(self):
        tr = ReadingTracker(grace_s=6)
        self.feed(tr, adv(c1=0x20), 0.0)
        out = self.feed(tr, adv(c1=0x22, impedance=498, when=datetime(2026, 11, 5, 7, 30, 19)), 3.0)
        self.assertEqual(out, [Reading(scale.to_ms(WHEN), 75.35, 498)])  # keeps the first stable frame's time
        self.assertEqual(tr.poll(30.0), [])

    def test_late_impedance_upgrades_same_time(self):
        tr = ReadingTracker(grace_s=6)
        self.feed(tr, adv(c1=0x20), 0.0)
        self.assertEqual(len(tr.poll(7.0)), 1)
        out = self.feed(tr, adv(c1=0x22, impedance=498, when=datetime(2026, 11, 5, 7, 30, 25)), 10.0)
        self.assertEqual(out, [Reading(scale.to_ms(WHEN), 75.35, 498)])

    def test_step_off_flushes_weight_only(self):
        tr = ReadingTracker(grace_s=6)
        self.feed(tr, adv(c1=0x20), 0.0)
        out = self.feed(tr, adv(c1=0xA0, when=datetime(2026, 11, 5, 7, 30, 20)), 2.0)
        self.assertEqual(out, [Reading(scale.to_ms(WHEN), 75.35, None)])

    def test_removed_frame_is_never_a_reading(self):
        tr = ReadingTracker()
        self.assertEqual(self.feed(tr, adv(c1=0xA2, impedance=512)), [])

    def test_two_weighins_are_separate(self):
        tr = ReadingTracker()
        later = datetime(2026, 11, 5, 19, 0, 0)
        first = self.feed(tr, adv(c1=0x22, impedance=512))
        second = tr.feed(adv(c1=0x22, impedance=500, raw_weight=15100, when=later), 100.0, scale.to_ms(later))
        self.assertEqual((len(first), len(second)), (1, 1))
        self.assertNotEqual(first[0].time_ms, second[0].time_ms)

    def test_unsynced_scale_clock_uses_receive_time(self):
        tr = ReadingTracker()
        out = tr.feed(adv(c1=0x22, impedance=512, when=datetime(2000, 1, 1, 0, 0, 5)), 0.0, NOW_MS)
        self.assertEqual(out[0].time_ms, NOW_MS)


class BodyCompTest(unittest.TestCase):
    """Fixtures from openScale's MiScaleLibTest.kt."""

    def check(self, sex, age, height, weight, imp, bmi, fat, bone, lbm, muscle_pct, water, visceral):
        lib = bodycomp.MiScaleLib(sex, age, height)
        self.assertAlmostEqual(lib.bmi(weight), bmi, places=3)
        self.assertAlmostEqual(lib.body_fat(weight, imp), fat, places=3)
        self.assertAlmostEqual(lib.bone_mass(weight, imp), bone, places=3)
        self.assertAlmostEqual(lib.lbm(weight, imp), lbm, places=3)
        self.assertAlmostEqual(lib.skeletal_muscle_pct(weight, imp), muscle_pct, places=3)
        self.assertAlmostEqual(lib.water(weight, imp), water, places=3)
        self.assertAlmostEqual(lib.visceral_fat(weight), visceral, places=3)

    def test_male_30y_180cm_80kg(self):
        self.check(1, 30, 180, 80, 500, 24.691359, 23.315107, 3.1254203, 58.222496, 40.977253, 52.605835, 13.359997)

    def test_female_28y_165cm_60kg(self):
        self.check(0, 28, 165, 60, 520, 22.038567, 30.361998, 2.4865808, 39.29622, 40.181103, 49.72153, -36.555004)

    def test_male_45y_175cm_95kg(self):
        self.check(1, 45, 175, 95, 430, 31.020409, 32.41778, 3.2726917, 60.93042, 36.096416, 48.2537, 24.462498)

    def test_age(self):
        self.assertEqual(bodycomp.age_on(date(1998, 4, 3), date(2026, 4, 2)), 27)
        self.assertEqual(bodycomp.age_on(date(1998, 4, 3), date(2026, 4, 3)), 28)

    def test_compose_user_profile(self):
        c = bodycomp.compose(75.35, 512, 177, 28, "male")
        self.assertAlmostEqual(c.bmi, 24.0516, places=3)
        self.assertAlmostEqual(c.bmr_kcal, 877.8 + 75.35 * 14.916 - 177 * 0.726 - 28 * 8.976, places=3)  # Xiaomi BMR
        self.assertAlmostEqual(c.muscle_kg, 75.35 - c.body_fat_pct * 0.01 * 75.35 - c.bone_kg, places=6)
        self.assertTrue(10 < c.body_fat_pct < 30 and 50 < c.water_pct < 65 and 2 < c.bone_kg < 4)
        self.assertTrue(1 <= c.visceral_fat <= 50)

    def test_compose_without_impedance(self):
        c = bodycomp.compose(75.35, None, 177, 28, "male")
        self.assertIsNone(c.body_fat_pct)
        self.assertIsNone(c.muscle_kg)
        self.assertGreater(c.bmi, 0)
        bad = bodycomp.compose(75.35, 5, 177, 28, "male")  # contact glitch
        self.assertIsNone(bad.body_fat_pct)

    def test_zepp_visceral_fat_is_sane_for_light_women(self):
        self.assertGreaterEqual(bodycomp.MiScaleLib(0, 28, 165).visceral_fat_zepp(60), 1)


class SamplesTest(unittest.TestCase):
    def test_all_scale_metrics_with_impedance(self):
        samples = scale.build_samples(Reading(NOW_MS, 75.35, 512), PROFILE)
        self.assertEqual({s.metric for s in samples},
                         {"weight_kg", "body_fat_pct", "muscle_kg", "water_pct", "bone_kg", "visceral_fat",
                          "bmr_kcal", "bmi", "impedance"})
        self.assertTrue(all(s.start == NOW_MS and s.end is None for s in samples))
        self.assertEqual(next(s for s in samples if s.metric == "weight_kg").value, 75.35)
        self.assertEqual(next(s for s in samples if s.metric == "impedance").value, 512)

    def test_weight_only(self):
        samples = scale.build_samples(Reading(NOW_MS, 75.35, None), PROFILE)
        self.assertEqual({s.metric for s in samples}, {"weight_kg", "visceral_fat", "bmr_kcal", "bmi"})

    def test_no_profile(self):
        samples = scale.build_samples(Reading(NOW_MS, 75.35, 512), None)
        self.assertEqual({s.metric for s in samples}, {"weight_kg", "impedance"})


if __name__ == "__main__":
    unittest.main()
