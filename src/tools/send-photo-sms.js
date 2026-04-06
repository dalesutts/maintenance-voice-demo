/**
 * Send an SMS to the resident with a photo upload link.
 * In production, this uses Twilio to send SMS with a link to the media upload portal.
 * For PoC, logs the action and returns a mock response.
 */
function sendPhotoSms({ phone_number, resident_name, sr_id }) {
  const uploadUrl = `https://maintenance.mynd.co/upload/${sr_id || 'pending'}`;

  console.log(`[SMS SENT] To: ${phone_number || '+15551234567'}`);
  console.log(`[SMS SENT] Message: "Hi ${resident_name || 'there'}, please upload photos of your maintenance issue here: ${uploadUrl}"`);

  // In production with Twilio:
  // const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // await twilio.messages.create({
  //   body: `Hi ${resident_name}, please upload photos of your maintenance issue here: ${uploadUrl}`,
  //   from: process.env.TWILIO_PHONE_NUMBER,
  //   to: phone_number
  // });

  return {
    success: true,
    sms_sent: true,
    phone_number: phone_number || '+15551234567',
    upload_url: uploadUrl,
    message: `Photo upload link sent to ${phone_number || 'resident\'s phone'}`
  };
}

const sendPhotoSmsTool = {
  name: 'send_photo_sms',
  description: 'Send an SMS text message to the resident with a link to upload photos of their maintenance issue. Call this during the conversation to collect visual documentation. This also helps buy processing time during SR creation — a natural conversation beat.',
  input_schema: {
    type: 'object',
    properties: {
      phone_number: {
        type: 'string',
        description: 'Resident\'s phone number (from property lookup or the calling number)'
      },
      resident_name: {
        type: 'string',
        description: 'Resident\'s first name for personalizing the SMS'
      },
      sr_id: {
        type: 'string',
        description: 'Service request ID if already created, or "pending" if SR creation is in progress'
      }
    },
    required: ['phone_number']
  }
};

module.exports = { sendPhotoSms, sendPhotoSmsTool };
