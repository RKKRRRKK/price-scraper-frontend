package app.kumquant.healthbridge.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kumquant.healthbridge.ui.health.Chevron
import app.kumquant.healthbridge.ui.health.Dot
import app.kumquant.healthbridge.ui.theme.Hb

/** Small widgets shared by the watch, settings and setup screens; surfaces come from health-ui's HbCard. */

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = Hb.Type.title, color = Hb.text, modifier = modifier.padding(bottom = 4.dp))
}

@Composable
fun BodyText(text: String, modifier: Modifier = Modifier, color: Color = Hb.text2) {
    Text(text, style = Hb.Type.body, color = color, modifier = modifier)
}

/** A label on the left and its value on the right; the value is always paired with a label. */
@Composable
fun KeyValue(label: String, value: String, modifier: Modifier = Modifier, valueColor: Color = Hb.text) {
    Row(modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
        Text(label, style = Hb.Type.body, color = Hb.text2, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Text(value, style = Hb.Type.bodyStrong, color = valueColor, textAlign = TextAlign.End, modifier = Modifier.weight(1.4f))
    }
}

@Composable
fun ToggleRow(title: String, checked: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier, text: String? = null) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = Hb.Type.body, color = Hb.text)
            if (text != null) Text(text, style = Hb.Type.label, color = Hb.text3)
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedTrackColor = Hb.hr, checkedThumbColor = Color.White,
                uncheckedTrackColor = Hb.panel2, uncheckedThumbColor = Hb.text3, uncheckedBorderColor = Hb.border2,
            ),
        )
    }
}

/** A tappable row with a chevron, for navigation inside a card. */
@Composable
fun LinkRow(title: String, onClick: () -> Unit, modifier: Modifier = Modifier, text: String? = null) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = Hb.Type.body, color = Hb.text)
            if (text != null) Text(text, style = Hb.Type.label, color = Hb.text3)
        }
        Chevron(1, Hb.text3, Modifier.padding(start = 8.dp).size(16.dp))
    }
}

@Composable
fun HbButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, primary: Boolean = false, enabled: Boolean = true) {
    val shape = RoundedCornerShape(14.dp)
    val bg = if (primary) Hb.hr else Hb.panel
    val fg = if (primary) Color.White else Hb.text
    Box(
        modifier
            .heightIn(min = 44.dp)
            .clip(shape)
            .background(if (enabled) bg else Hb.panel2)
            .then(if (primary) Modifier else Modifier.border(BorderStroke(1.dp, Hb.border2), shape))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = Hb.Type.bodyStrong, color = if (enabled) fg else Hb.text3, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Coloured dot with a status word, for "Connected", "Done", "Needs setup". */
@Composable
fun StatusPill(label: String, color: Color, modifier: Modifier = Modifier) {
    Row(
        modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Dot(color, 8.dp)
        Spacer(Modifier.width(6.dp))
        Text(label, style = Hb.Type.label, color = color)
    }
}

@Composable
fun Cards(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
}
