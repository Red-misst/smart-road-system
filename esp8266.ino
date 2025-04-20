#include <WebSockets2_Generic.h>
#include <ESP8266WiFi.h>
#include <Arduino_JSON.h>

using namespace websockets2_generic;

// WiFi credentials
const char* ssid = "riecelle";
const char* password = "rie123456";

// WebSocket server details
const char* ws_server = "smart-drainage-system.onrender.com"; // Domain only
const uint16_t ws_port = 443; // Secure WebSocket port

WebsocketsClient client;
bool wsConnected = false;

// Ultrasonic sensor pins
#define TRIGGER_PIN 5  // GPIO5 (D1 on NodeMCU)
#define ECHO_PIN    4  // GPIO4 (D2 on NodeMCU)

// Function to connect to WiFi
void connectToWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  int retries = 0;

  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nFailed to connect to WiFi! Retrying...");
  }
}

// WebSocket event callback
void onEventsCallback(WebsocketsEvent event, String data) {
  switch (event) {
    case WebsocketsEvent::ConnectionOpened:
      Serial.println("[WS] Connection Opened");
      wsConnected = true;
      client.send("Client Connected");
      break;
    case WebsocketsEvent::ConnectionClosed:
      Serial.println("[WS] Connection Closed, reconnecting...");
      wsConnected = false;
      break;
    case WebsocketsEvent::GotPing:
      Serial.println("[WS] Received Ping!");
      break;
    case WebsocketsEvent::GotPong:
      Serial.println("[WS] Received Pong!");
      break;
  }
}

// Function to connect to WebSocket
void connectToWebSocket() {
  Serial.println("Connecting to WebSocket server...");
  client.setInsecure(); // Accept any SSL certificate (for testing)

  client.onEvent(onEventsCallback);

  String ws_url = "wss://" + String(ws_server) + "/"; // Construct secure WebSocket URL
  if (client.connect(ws_url)) {
    Serial.println("[WS] Connected to WebSocket Server");
    wsConnected = true;
  } else {
    Serial.println("[WS] WebSocket Connection Failed! Retrying...");
    wsConnected = false;
  }
}

// Function to measure distance using HC-SR04
long measureDistance() {
  digitalWrite(TRIGGER_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIGGER_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIGGER_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  long distance = duration * 0.0343 / 2;
  return distance > 400 ? -1 : distance; // Filter out unrealistic values
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIGGER_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  connectToWiFi();
  connectToWebSocket();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, reconnecting...");
    connectToWiFi();
    connectToWebSocket();
  }

  if (!wsConnected) {
    Serial.println("WebSocket disconnected, reconnecting...");
    connectToWebSocket();
  }

  if (client.available()) {
    client.poll();
  }

  if (wsConnected) {
    long distance = measureDistance();

    if (distance != -1) {
      Serial.printf("Measured Distance: %ld cm\n", distance);

      // Create JSON object
      JSONVar jsonObject;
      jsonObject["sensorId"] = "ultrasonicSensor1";
      jsonObject["distance"] = distance;

      // Convert to JSON string and send
      String jsonString = JSON.stringify(jsonObject);
      Serial.println("Sending: " + jsonString);
      client.send(jsonString);
    } else {
      Serial.println("Invalid distance measurement. Skipping send.");
    }
  }

  delay(1000);
}
