package app.kumquant.healthbridge.watch.activity.impl

import app.kumquant.healthbridge.watch.activity.ActivityFileId

/** A Xiaomi sport and the Health Connect ExerciseSessionRecord type it maps to. */
internal data class XiaomiSport(val code: Int, val name: String, val hcType: Int, val exact: Boolean)

/**
 * Xiaomi sport ids (codes from Gadgetbridge's XiaomiWorkoutType) to Health Connect `EXERCISE_TYPE_*` ints.
 * [exact] is false when the Health Connect type is only the nearest relative (a kayak ride is "paddling"); the
 * session then also carries the Xiaomi name as its title. Sports with no relative map to OTHER_WORKOUT (0).
 */
internal object XiaomiSports {
    const val OTHER_WORKOUT = 0

    // ExerciseSessionRecord.EXERCISE_TYPE_* values (androidx.health.connect:connect-client 1.1.0)
    private const val BADMINTON = 2
    private const val BASEBALL = 4
    private const val BASKETBALL = 5
    private const val BIKING = 8
    private const val BIKING_STATIONARY = 9
    private const val BOXING = 11
    private const val CALISTHENICS = 13
    private const val CRICKET = 14
    private const val DANCING = 16
    private const val ELLIPTICAL = 25
    private const val EXERCISE_CLASS = 26
    private const val FENCING = 27
    private const val FOOTBALL_AMERICAN = 28
    private const val FRISBEE_DISC = 31
    private const val GOLF = 32
    private const val GYMNASTICS = 34
    private const val HANDBALL = 35
    private const val HIIT = 36
    private const val HIKING = 37
    private const val ICE_HOCKEY = 38
    private const val ICE_SKATING = 39
    private const val MARTIAL_ARTS = 44
    private const val PADDLING = 46
    private const val PARAGLIDING = 47
    private const val PILATES = 48
    private const val ROCK_CLIMBING = 51
    private const val ROWING = 53
    private const val ROWING_MACHINE = 54
    private const val RUNNING = 56
    private const val RUNNING_TREADMILL = 57
    private const val SAILING = 58
    private const val SCUBA_DIVING = 59
    private const val SKATING = 60
    private const val SKIING = 61
    private const val SNOWBOARDING = 62
    private const val SOCCER = 64
    private const val SOFTBALL = 65
    private const val SQUASH = 66
    private const val STAIR_CLIMBING = 68
    private const val STAIR_CLIMBING_MACHINE = 69
    private const val STRENGTH_TRAINING = 70
    private const val STRETCHING = 71
    private const val SURFING = 72
    private const val SWIMMING_OPEN_WATER = 73
    private const val SWIMMING_POOL = 74
    private const val TABLE_TENNIS = 75
    private const val TENNIS = 76
    private const val VOLLEYBALL = 78
    private const val WALKING = 79
    private const val WATER_POLO = 80
    private const val WEIGHTLIFTING = 81
    private const val YOGA = 83

    private val table: Map<Int, XiaomiSport> = buildList {
        fun s(code: Int, name: String, hc: Int, exact: Boolean = true) = add(XiaomiSport(code, name, hc, exact))
        fun other(code: Int, name: String) = s(code, name, OTHER_WORKOUT, false)

        s(1, "Outdoor running", RUNNING)
        s(2, "Walking", WALKING)
        s(3, "Hiking", HIKING)
        s(4, "Trekking", HIKING, false)
        s(5, "Trail run", RUNNING, false)
        s(6, "Outdoor cycling", BIKING)
        s(7, "Indoor cycling", BIKING_STATIONARY)
        other(8, "Freestyle")
        s(9, "Pool swimming", SWIMMING_POOL)
        s(10, "Open water swimming", SWIMMING_OPEN_WATER)
        s(11, "Elliptical", ELLIPTICAL)
        s(12, "Yoga", YOGA)
        s(13, "Rowing machine", ROWING_MACHINE)
        other(14, "Jump rope")
        s(15, "Outdoor walking", WALKING)
        s(16, "HIIT", HIIT)
        other(17, "Triathlon")
        s(100, "Sailing", SAILING)
        s(101, "Paddleboarding", PADDLING, false)
        s(102, "Water polo", WATER_POLO)
        other(103, "Other water sports")
        other(104, "Water skiing")
        s(105, "Kayaking", PADDLING, false)
        s(106, "Rafting", PADDLING, false)
        s(107, "Rowing", ROWING)
        other(108, "Powerboating")
        s(109, "Finswimming", SWIMMING_OPEN_WATER, false)
        s(110, "Diving", SCUBA_DIVING, false)
        s(111, "Artistic swimming", SWIMMING_POOL, false)
        s(112, "Snorkeling", SWIMMING_OPEN_WATER, false)
        s(113, "Kitesurfing", SURFING, false)
        s(114, "Flowriding", SURFING, false)
        s(115, "Dragon boat", PADDLING, false)
        s(200, "Rock climbing", ROCK_CLIMBING)
        s(201, "Skateboarding", SKATING, false)
        s(202, "Roller skating", SKATING, false)
        other(203, "Parkour")
        other(204, "ATV")
        s(205, "Paragliding", PARAGLIDING)
        s(206, "BMX", BIKING, false)
        s(207, "Race walking", WALKING, false)
        s(300, "Stair climber", STAIR_CLIMBING_MACHINE)
        s(301, "Stair climbing", STAIR_CLIMBING)
        s(302, "Stepper", STAIR_CLIMBING_MACHINE, false)
        s(303, "Core training", CALISTHENICS, false)
        s(304, "Flexibility", STRETCHING, false)
        s(305, "Pilates", PILATES)
        s(306, "Gymnastics", GYMNASTICS)
        s(307, "Stretching", STRETCHING)
        s(308, "Strength training", STRENGTH_TRAINING)
        other(309, "Cross training")
        s(310, "Aerobics", EXERCISE_CLASS, false)
        other(311, "Physical training")
        other(312, "Wall ball")
        s(313, "Dumbbell", STRENGTH_TRAINING, false)
        s(314, "Barbell", WEIGHTLIFTING, false)
        s(315, "Weightlifting", WEIGHTLIFTING)
        s(316, "Deadlift", WEIGHTLIFTING, false)
        s(317, "Burpee", CALISTHENICS, false)
        s(318, "Sit-ups", CALISTHENICS, false)
        other(319, "Functional training")
        s(320, "Upper body", STRENGTH_TRAINING, false)
        s(321, "Lower body", STRENGTH_TRAINING, false)
        s(322, "Abs", CALISTHENICS, false)
        s(323, "Back", STRENGTH_TRAINING, false)
        s(324, "Spinning", BIKING_STATIONARY, false)
        s(325, "Air walker", ELLIPTICAL, false)
        s(326, "Step aerobics", EXERCISE_CLASS, false)
        s(327, "Horizontal bar", GYMNASTICS, false)
        s(328, "Parallel bars", GYMNASTICS, false)
        s(329, "Mass gymnastics", GYMNASTICS, false)
        s(330, "Cardio combat", EXERCISE_CLASS, false)
        other(331, "Battle rope")
        s(332, "Aerobic combo", EXERCISE_CLASS, false)
        s(333, "Indoor walking", WALKING, false)
        other(399, "Indoor fitness")
        for ((code, name) in listOf(
            400 to "Square dancing", 401 to "Belly dance", 402 to "Ballet", 403 to "Street dance", 404 to "Zumba",
            405 to "Folk dance", 406 to "Jazz dance", 407 to "Latin dance", 408 to "Hip hop", 409 to "Pole dance",
            410 to "Breaking", 411 to "Ballroom dance", 412 to "Modern dance",
        )) s(code, name, DANCING, false)
        s(499, "Dancing", DANCING)
        s(500, "Boxing", BOXING)
        s(501, "Wrestling", MARTIAL_ARTS, false)
        s(502, "Martial arts", MARTIAL_ARTS)
        s(503, "Tai chi", MARTIAL_ARTS, false)
        s(504, "Muay Thai", MARTIAL_ARTS, false)
        s(505, "Judo", MARTIAL_ARTS, false)
        s(506, "Taekwondo", MARTIAL_ARTS, false)
        s(507, "Karate", MARTIAL_ARTS, false)
        s(508, "Kickboxing", MARTIAL_ARTS, false)
        s(509, "Kendo", MARTIAL_ARTS, false)
        s(510, "Fencing", FENCING)
        s(511, "Jujitsu", MARTIAL_ARTS, false)
        s(600, "Soccer", SOCCER)
        s(601, "Basketball", BASKETBALL)
        s(602, "Volleyball", VOLLEYBALL)
        s(603, "Baseball", BASEBALL)
        s(604, "Softball", SOFTBALL)
        s(605, "American football", FOOTBALL_AMERICAN)
        other(606, "Hockey")
        s(607, "Table tennis", TABLE_TENNIS)
        s(608, "Badminton", BADMINTON)
        s(609, "Tennis", TENNIS)
        s(610, "Cricket", CRICKET)
        s(611, "Handball", HANDBALL)
        other(612, "Bowling")
        s(613, "Squash", SQUASH)
        other(614, "Billiards")
        other(615, "Shuttlecock")
        s(616, "Beach soccer", SOCCER, false)
        s(617, "Beach volleyball", VOLLEYBALL, false)
        other(618, "Sepak takraw")
        s(619, "Golf", GOLF)
        other(620, "Table football")
        s(621, "Futsal", SOCCER, false)
        other(622, "Hacky sack")
        other(623, "Bocce")
        other(624, "Jai alai")
        other(625, "Gateball")
        other(626, "Dodgeball")
        other(627, "Shuffleboard")
        s(700, "Ice skating", ICE_SKATING)
        other(701, "Curling")
        other(702, "Other winter sports")
        other(703, "Snowmobile")
        s(704, "Ice hockey", ICE_HOCKEY)
        other(705, "Bobsleigh")
        other(706, "Sledding")
        s(707, "Indoor ice skating", ICE_SKATING, false)
        s(708, "Snowboarding", SNOWBOARDING)
        s(709, "Skiing", SKIING)
        other(800, "Archery")
        other(801, "Darts")
        other(802, "Horse riding")
        other(803, "Tug of war")
        other(804, "Hula hoop")
        other(805, "Kite flying")
        other(806, "Fishing")
        s(807, "Frisbee", FRISBEE_DISC)
        other(808, "Shuttlecock")
        other(809, "Swinging")
        other(810, "Somatosensory game")
        other(811, "Esports")
        other(900, "Chess")
        other(901, "Checkers")
        other(902, "Weiqi")
        other(903, "Bridge")
        other(904, "Board game")
        other(10000, "Equestrian")
        other(10001, "Athletics")
        other(10002, "Auto racing")
    }.associateBy { it.code }

    /** The sport for a Xiaomi code, or an unknown-code placeholder that still names it. */
    fun of(code: Int): XiaomiSport = table[code] ?: XiaomiSport(code, "Workout $code", OTHER_WORKOUT, false)

    /** Sport implied by the file id subtype when the summary carries no sport field (null: treadmill, which has no code). */
    fun ofSubtype(subtype: Int): XiaomiSport? = when (subtype) {
        ActivityFileId.SPORTS_OUTDOOR_RUNNING -> of(1)
        ActivityFileId.SPORTS_OUTDOOR_WALKING_V1 -> of(2)
        ActivityFileId.SPORTS_TREADMILL -> XiaomiSport(-1, "Treadmill", RUNNING_TREADMILL, true)
        ActivityFileId.SPORTS_OUTDOOR_CYCLING_V2,
        ActivityFileId.SPORTS_OUTDOOR_CYCLING -> of(6)
        ActivityFileId.SPORTS_INDOOR_CYCLING -> of(7)
        ActivityFileId.SPORTS_FREESTYLE -> of(8)
        ActivityFileId.SPORTS_POOL_SWIMMING -> of(9)
        ActivityFileId.SPORTS_ELLIPTICAL -> of(11)
        ActivityFileId.SPORTS_ROWING -> of(13)
        ActivityFileId.SPORTS_JUMP_ROPING -> of(14)
        ActivityFileId.SPORTS_HIIT -> of(16)
        else -> null
    }
}
