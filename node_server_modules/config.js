// config.js
import dotenv from 'dotenv';
dotenv.config();

export const isProduction = process.env.NODE_ENV === 'production';
export const serverConfig = {
  wsUrl: isProduction ? process.env.NODE_SERVER_URL_PRODUCTION : process.env.NODE_SERVER_URL_LOCAL,
  host: isProduction ? process.env.NODE_SERVER_HOST_PRODUCTION : process.env.NODE_SERVER_HOST_LOCAL,
  port: isProduction ? process.env.NODE_SERVER_PORT_PRODUCTION : process.env.NODE_SERVER_PORT_LOCAL
};
export const SMS_CONFIG = {
  BASE_URL: 'https://api.textbee.dev/api/v1',
  DEVICE_ID: process.env.TEXTBEE_DEVICE_ID,
  API_KEY: process.env.TEXTBEE_API_KEY,
  ACCIDENT_NUMBER: process.env.ACCIDENT_NOTIFY_NUMBER,
  THRESHOLD_NUMBER: process.env.THRESHOLD_NOTIFY_NUMBER
};
