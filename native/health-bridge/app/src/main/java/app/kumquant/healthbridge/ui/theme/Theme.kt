package app.kumquant.healthbridge.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Colour and type tokens for the whole app. The palette mirrors the web
 * dashboard's `src/lib/health/theme.js` (light only) so phone and web match;
 * `text3` is a notch darker than the web value to hold 4.5:1 on white.
 * Every style uses tabular figures so changing numbers do not jitter.
 */
object Hb {
    val bg = Color(0xFFF3F5F8)
    val panel = Color(0xFFFFFFFF)
    val panel2 = Color(0xFFF4F6F9)
    val border = Color(0x140F172A)
    val border2 = Color(0x260F172A)
    val text = Color(0xFF0F172A)
    val text2 = Color(0xFF475569)
    val text3 = Color(0xFF667085)
    val grid = Color(0x0F0F172A)
    val axis = Color(0x240F172A)

    val hr = Color(0xFFE11D48)
    val resting = Color(0xFFBE123C)
    val steps = Color(0xFF10B981)
    val kcal = Color(0xFFF97316)
    val distance = Color(0xFF65A30D)
    val spo2 = Color(0xFF0EA5E9)
    val hrv = Color(0xFF8B5CF6)
    val resp = Color(0xFF14B8A6)
    val weight = Color(0xFF64748B)
    val vo2 = Color(0xFFDB2777)
    val sync = Color(0xFF16A34A)
    val warn = Color(0xFFD97706)
    val bad = Color(0xFFDC2626)

    /** Stress and body energy have no web colour yet; these sit in the same saturation range. */
    val stress = Color(0xFFEAB308)
    val energy = Color(0xFF0D9488)
    val sleep = Color(0xFF6366F1)

    val sleepAwake = Color(0xFFF59E0B)
    val sleepRem = Color(0xFF06B6D4)
    val sleepLight = Color(0xFF818CF8)
    val sleepDeep = Color(0xFF4338CA)

    /** Xiaomi's 0-100 stress bands. */
    val stressRelaxed = Color(0xFF10B981)
    val stressMild = Color(0xFFEAB308)
    val stressModerate = Color(0xFFF97316)
    val stressHigh = Color(0xFFDC2626)

    /** Heart-rate zones as fractions of max HR, same five as Mi Fitness plus "Relaxed" below 50 %. */
    class Zone(val key: String, val label: String, val from: Double, val to: Double, val color: Color)

    val zones = listOf(
        Zone("rest", "Relaxed", 0.0, 0.5, Color(0xFF64748B)),
        Zone("warmup", "Warm-up", 0.5, 0.6, Color(0xFF0EA5E9)),
        Zone("fatburn", "Fat burn", 0.6, 0.7, Color(0xFF10B981)),
        Zone("aerobic", "Aerobic", 0.7, 0.8, Color(0xFFEAB308)),
        Zone("anaerobic", "Anaerobic", 0.8, 0.9, Color(0xFFF97316)),
        Zone("max", "Max", 0.9, Double.POSITIVE_INFINITY, Color(0xFFE11D48)),
    )

    /** Max HR for the user (age 28). */
    const val MAX_HR = 192

    /** Daily step goal. */
    const val STEP_GOAL = 8000


    object Type {
        val display = TextStyle(fontSize = 30.sp, lineHeight = 34.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp, fontFeatureSettings = tnumF)
        val value = TextStyle(fontSize = 24.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp, fontFeatureSettings = tnumF)
        val unit = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium, fontFeatureSettings = tnumF)
        val title = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, fontFeatureSettings = tnumF)
        val body = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal, fontFeatureSettings = tnumF)
        val bodyStrong = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold, fontFeatureSettings = tnumF)
        val label = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.2.sp, fontFeatureSettings = tnumF)
        val caption = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Normal, fontFeatureSettings = tnumF)
        val axis = TextStyle(fontSize = 10.sp, lineHeight = 12.sp, fontWeight = FontWeight.Medium, fontFeatureSettings = tnumF)
    }
}

private const val tnumF = "tnum"

private val HbColors = lightColorScheme(
    primary = Hb.hr,
    onPrimary = Color.White,
    background = Hb.bg,
    onBackground = Hb.text,
    surface = Hb.panel,
    onSurface = Hb.text,
    surfaceVariant = Hb.panel2,
    onSurfaceVariant = Hb.text2,
    outline = Hb.border2,
    outlineVariant = Hb.border,
    error = Hb.bad,
)

private val HbTypography = Typography(
    displayLarge = Hb.Type.display,
    headlineMedium = Hb.Type.value,
    titleMedium = Hb.Type.title,
    bodyLarge = Hb.Type.body,
    bodyMedium = Hb.Type.body,
    labelMedium = Hb.Type.label,
    labelSmall = Hb.Type.caption,
)

/** Light theme only; ignores the system dark setting by design. */
@Composable
fun HealthBridgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = HbColors, typography = HbTypography, content = content)
}
