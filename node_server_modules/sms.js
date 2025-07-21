// sms.js
import axios from 'axios';
import { SMS_CONFIG } from './config.js';
export async function sendSMSAlert(recipient, message) {
  try {
    const response = await axios.post(
      `${SMS_CONFIG.BASE_URL}/gateway/devices/${SMS_CONFIG.DEVICE_ID}/send-sms`,
      {
        recipients: [recipient],
        message: message
      },
      { headers: { 'x-api-key': SMS_CONFIG.API_KEY } }
    );
    console.log('[SMS ALERT] Successfully sent SMS:', response.data);
  } catch (error) {
    console.error('[SMS ALERT] Failed to send SMS:', error.message);
  }
}
