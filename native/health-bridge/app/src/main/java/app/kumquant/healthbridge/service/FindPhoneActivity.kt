package app.kumquant.healthbridge.service

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.kumquant.healthbridge.ui.theme.Hb
import app.kumquant.healthbridge.ui.theme.HealthBridgeTheme

/** Over-the-lock-screen "your watch is looking for this phone" with a Stop button. */
class FindPhoneActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        setContent { HealthBridgeTheme { Screen(onStop = { FindPhone.stop(this); finish() }, onDone = { finish() }) } }
    }

    @Composable
    private fun Screen(onStop: () -> Unit, onDone: () -> Unit) {
        val ringing by FindPhone.ringing.collectAsState()
        LaunchedEffect(ringing) { if (!ringing) onDone() }

        Column(
            Modifier.fillMaxSize().background(Hb.bg).systemBarsPadding().padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Your watch is looking for this phone", style = Hb.Type.value, color = Hb.text, textAlign = TextAlign.Center)
            Spacer(Modifier.height(32.dp))
            Button(
                onClick = onStop,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Hb.hr),
            ) { Text("Stop", style = Hb.Type.title) }
        }
    }
}
