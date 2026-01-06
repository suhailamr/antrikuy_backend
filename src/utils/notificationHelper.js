const admin = require("firebase-admin");

// Kirim ke satu user (FCM TOKEN)
exports.sendPushNotification = async (fcmToken, title, body, payload = {}) => {
  console.log("📨 [FCM DEBUG] sendPushNotification dipanggil", {
    hasToken: !!fcmToken,
    tokenPreview: fcmToken ? fcmToken.slice(0, 20) : null,
    title,
    body,
    payload,
  });

  if (!fcmToken) {
    console.warn("⚠️ [FCM DEBUG] Token kosong, notif dibatalkan");
    return;
  }

  const message = {
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, String(v)])
    ),
    token: fcmToken,
  };

  try {
    const res = await admin.messaging().send(message);
    console.log("✅ [FCM DEBUG] Firebase menerima notif", res);
  } catch (err) {
    console.error("❌ [FCM ERROR]", err.code, err.message);
  }
};

// Kirim ke TOPIC
exports.sendTopicNotification = async (topic, title, body, payload = {}) => {
  console.log("📣 [FCM DEBUG] sendTopicNotification", { topic, title });

  try {
    await admin.messaging().send({
      notification: { title, body },
      data: payload,
      topic,
    });
    console.log("✅ [FCM DEBUG] Topic notif terkirim");
  } catch (err) {
    console.error("❌ [FCM TOPIC ERROR]", err.code, err.message);
  }
};
