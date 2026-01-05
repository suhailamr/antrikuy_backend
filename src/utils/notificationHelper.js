const admin = require("firebase-admin");

// Kirim ke satu user spesifik berdasarkan Token FCM
exports.sendPushNotification = async (fcmToken, title, body, payload = {}) => {
  if (!fcmToken) return;
  const message = {
    notification: { title, body },
    data: payload, // Tambahkan data tambahan (misal ID antrian)
    token: fcmToken,
  };
  try {
    await admin.messaging().send(message);
    console.log("✅ Notifikasi terkirim");
  } catch (error) {
    console.error("❌ Gagal kirim notif:", error);
  }
};

// Kirim ke banyak user sekaligus berdasarkan TOPIK
exports.sendTopicNotification = async (topic, title, body, payload = {}) => {
  const message = {
    notification: { title, body },
    data: payload,
    topic: topic,
  };
  try {
    await admin.messaging().send(message);
  } catch (error) {
    console.error("❌ Gagal kirim topik:", error);
  }
};
