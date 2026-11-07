package app.kumquant.healthbridge.ui.health

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.kumquant.healthbridge.ui.theme.Hb
import app.kumquant.healthbridge.ui.theme.HealthBridgeTheme
import kotlin.math.sin

@Preview(showBackground = true, widthDp = 380, heightDp = 1250)
@Composable
private fun ChartsPreview() = HealthBridgeTheme {
    val hr = (0 until 1440 step 2).map { Pt(it * 60_000.0, 68 + 24 * sin(it / 180.0).coerceAtLeast(0.0) + 6 * sin(it / 7.0)) }
    val night = SleepNight(
        "p", 0, 7 * 3_600_000L,
        listOf(Stage("light", 0, 3_000_000), Stage("deep", 3_000_000, 7_000_000), Stage("rem", 7_000_000, 11_000_000), Stage("awake", 11_000_000, 11_600_000), Stage("light", 11_600_000, 25_200_000)),
    )
    Column(Modifier.background(Hb.bg).padding(16.dp)) {
        HbCard(Modifier.fillMaxWidth()) {
            CardTitle("Heart rate", trailing = "bpm")
            LineChart(
                listOf(LineSpec(hr, Hb.hr, fill = false)), 0.0, 1440 * 60_000.0, 40.0, 140.0,
                bands = Hb.zones.map { Band(it.from * Hb.MAX_HR, if (it.to.isInfinite()) 260.0 else it.to * Hb.MAX_HR, it.color, it.label) },
                xTicks = (0..24 step 6).map { it * 3_600_000.0 to "%02d".format(it % 24) },
            )
        }
        HbCard(Modifier.fillMaxWidth().padding(top = 12.dp)) {
            CardTitle("Steps by day", trailing = "steps")
            BarChart(
                (0 until 7).map { BarSpec(4000.0 + it * 900, Hb.steps, "Day $it", "${4000 + it * 900} steps", "MTWTFSS"[it].toString()) },
                yMax = 12000.0, yTicks = listOf(0.0, 4000.0, 8000.0, 12000.0), goal = 8000.0, goalLabel = "Goal 8,000",
            )
        }
        HbCard(Modifier.fillMaxWidth().padding(top = 12.dp)) {
            CardTitle("Range by day", trailing = "bpm")
            RangeChart(
                (0 until 7).map { RangeSpec(52.0 + it, 110.0 + it * 6, 70.0 + it, Hb.hr, "Day $it", "range", "MTWTFSS"[it].toString()) },
                40.0, 160.0,
            )
        }
        HbCard(Modifier.fillMaxWidth().padding(top = 12.dp)) {
            CardTitle("Stages")
            Hypnogram(night)
            ProgressRing(0.68f, Hb.steps, Modifier.size(64.dp))
        }
    }
}
