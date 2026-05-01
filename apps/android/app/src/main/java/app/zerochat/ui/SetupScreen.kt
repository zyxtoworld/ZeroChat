package app.zerochat.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun SetupScreen(onDone: () -> Unit) {
    val baseUrl = remember { mutableStateOf("https://api.openai.com/v1") }
    val model = remember { mutableStateOf("") }

    Column(modifier = Modifier.padding(16.dp)) {
        Text("首次配置")
        OutlinedTextField(
            value = baseUrl.value,
            onValueChange = { baseUrl.value = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Base URL") },
        )
        OutlinedTextField(
            value = model.value,
            onValueChange = { model.value = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("模型") },
        )
        Button(onClick = onDone) {
            Text("完成")
        }
    }
}
