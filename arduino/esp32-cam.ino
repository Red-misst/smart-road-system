#include "esp_camera.h"
#include <WiFi.h>
#include <WebSocketsClient.h>

// Wi-Fi credentials
const char* ssid = "Tenda_5C30C8";
const char* password = "op898989..";

// WebSocket server
const char* ws_server_ip = "192.168.0.105";
const uint16_t ws_server_port = 443;
const char* ws_path = "/?type=camera";

const char* camera_id = "camera1";
const char* camera_position = "Entrance";
const char* camera_description = "Main entrance monitoring camera";

// Controls
const int min_frame_time = 16; // ~62.5 FPS cap
unsigned long lastFrameSent = 0;

WebSocketsClient webSocket;

// Optimized for CIF @ 60 FPS + best quality
camera_config_t camera_config = {
  .pin_pwdn       = 32,
  .pin_reset      = -1,
  .pin_xclk       = 0,
  .pin_sscb_sda   = 26,
  .pin_sscb_scl   = 27,
  .pin_d7         = 35,
  .pin_d6         = 34,
  .pin_d5         = 39,
  .pin_d4         = 36,
  .pin_d3         = 21,
  .pin_d2         = 19,
  .pin_d1         = 18,
  .pin_d0         = 5,
  .pin_vsync      = 25,
  .pin_href       = 23,
  .pin_pclk       = 22,
  .xclk_freq_hz   = 24000000,                  // MAX for high-speed JPEG capture
  .ledc_timer     = LEDC_TIMER_0,
  .ledc_channel   = LEDC_CHANNEL_0,
  .pixel_format   = PIXFORMAT_JPEG,
  .frame_size     = FRAMESIZE_CIF,             // 352x288 @ up to 60 FPS
  .jpeg_quality   = 10,                        // Balance quality and size (lower = better)
  .fb_count       = psramFound() ? 2 : 1,
  .fb_location    = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM,
  .grab_mode      = CAMERA_GRAB_LATEST
};

void sendCameraInfo() {
  String info = "{\"type\":\"camera_info\"," 
                "\"id\":\"" + String(camera_id) + "\"," +
                "\"position\":\"" + String(camera_position) + "\"," +
                "\"description\":\"" + String(camera_description) + "\"," +
                "\"resolution\":\"352x288\"," +
                "\"fps\":\"" + String(1000 / min_frame_time) + "\"," +
                "\"timestamp\":\"" + String(millis()) + "\"}";
  
  webSocket.sendTXT(info);
  Serial.println("[WS] Sent camera info: " + String(camera_id));
}

void handleCommand(char* command) {
  String cmd = String(command);
  if (cmd.indexOf("get_info") >= 0) sendCameraInfo();
  else if (cmd.indexOf("identify") >= 0) {
    String response = "{\"type\":\"identify\",\"id\":\"" + String(camera_id) +
                      "\",\"timestamp\":\"" + String(millis()) + "\"}";
    webSocket.sendTXT(response);
  }
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_CONNECTED:
      Serial.println("[WS] Connected");
      sendCameraInfo();
      break;
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected");
      break;
    case WStype_TEXT:
      handleCommand((char*)payload);
      break;
    case WStype_ERROR:
      Serial.println("[WS] Error");
      break;
    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(false);
  Serial.println("ESP32-CAM Starting...");

  if (esp_camera_init(&camera_config) != ESP_OK) {
    Serial.println("[CAM] Initialization failed");
    return;
  }
  Serial.println("[CAM] Initialized");

  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
    delay(300);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected: " + WiFi.localIP().toString());
    webSocket.begin(ws_server_ip, ws_server_port, ws_path);
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(1000);
    webSocket.enableHeartbeat(10000, 3000, 2);
  } else {
    Serial.println("\n[WiFi] Failed to connect");
  }
}

void loop() {
  webSocket.loop();
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(500);
    return;
  }

  unsigned long now = millis();
  if (now - lastFrameSent < min_frame_time) return;

  lastFrameSent = now;

  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM] Frame capture failed");
    return;
  }

  String metadata = "{\"type\":\"frame_metadata\",\"id\":\"" + String(camera_id) + 
                    "\",\"timestamp\":" + String(millis()) + "}";
  webSocket.sendTXT(metadata);

  if (webSocket.isConnected()) {
    bool sent = webSocket.sendBIN(fb->buf, fb->len);
    if (!sent) Serial.println("[WS] Frame send failed");
  }

  esp_camera_fb_return(fb);
}