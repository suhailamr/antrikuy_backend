const User = require("../models/User");
const admin = require("firebase-admin");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// services/authService.js

// 🔥 PERBAIKAN: Terima parameter 'user' untuk cek peran
function validateBiodataRequired(user, body = {}) {
  // Jika Super Admin atau Peneliti, SKIP validasi wajib
  if (user.peran === "SUPER_ADMIN" || user.peran === "PENELITI") {
    return; // Bebas update apa saja tanpa syarat wajib
  }

  // Validasi khusus untuk User Biasa (Siswa/Admin Sekolah)
  if (body.namaPengguna !== undefined && body.namaPengguna.trim() === "") {
    throw new Error("Nama wajib diisi");
  }

  // Tanggal Lahir boleh skip jika tidak sedang diupdate (undefined), tapi jika diupdate tidak boleh kosong
  if (body.tanggalLahir !== undefined && !body.tanggalLahir) {
    throw new Error("Tanggal lahir wajib diisi");
  }

  // Kategori Sekolah wajib bagi user biasa
  if (body.kategoriSekolah !== undefined && !body.kategoriSekolah) {
    throw new Error("Kategori sekolah wajib diisi");
  }

  if (body.kelas !== undefined && !body.kelas) {
    throw new Error("Kelas wajib diisi");
  }

  if (body.namaOrangTua !== undefined && body.namaOrangTua.trim() === "") {
    throw new Error("Nama orang tua wajib diisi");
  }
}

// ... (fungsi applyBiodata tetap sama) ...

async function updateCurrentUserBiodata(userDoc, biodata = {}) {
  if (!userDoc || !userDoc.save) {
    throw new Error("Objek user tidak valid. Pastikan login berhasil.");
  }

  // 🔥 PERBAIKAN: Kirim 'userDoc' ke validator
  validateBiodataRequired(userDoc, biodata);

  applyBiodata(userDoc, biodata);

  await userDoc.save();
  return userDoc;
}

function applyBiodata(user, body = {}) {
  if (body.namaPengguna !== undefined) user.namaPengguna = body.namaPengguna;

  if (body.email !== undefined && body.email !== null && body.email !== "") {
    user.email = body.email.toLowerCase();
  }

  if (body.noHp && body.noHp.trim() !== "") {
    user.noHp = body.noHp;
  }
  if (body.alamat !== undefined) user.alamat = body.alamat;
  if (body.nis !== undefined) {
    if (body.nis === "" || body.nis === null) {
      user.nis = undefined;
    } else {
      user.nis = body.nis;
    }
  }
  if (body.tempatLahir !== undefined) user.tempatLahir = body.tempatLahir;
  if (body.tanggalLahir !== undefined)
    user.tanggalLahir = new Date(body.tanggalLahir);
  if (body.kategoriSekolah !== undefined)
    user.kategoriSekolah = body.kategoriSekolah;
  if (body.kelas !== undefined) user.kelas = body.kelas;
  if (body.jurusan !== undefined) user.jurusan = body.jurusan;
  if (body.namaOrangTua !== undefined) user.namaOrangTua = body.namaOrangTua;
  if (body.diwakiliOrangTua !== undefined)
    user.diwakiliOrangTua = !!body.diwakiliOrangTua;
  if (body.idSekolah !== undefined) user.idSekolah = body.idSekolah;
  if (body.fotoProfil !== undefined) user.fotoProfil = body.fotoProfil;
  if (body.fotoSampul !== undefined) user.fotoSampul = body.fotoSampul;
  if (body.metodeLoginAwal !== undefined)
    user.metodeLoginAwal = body.metodeLoginAwal;
}

async function sendEmailOtp(targetEmail) {
  if (!targetEmail) throw new Error("Email tujuan wajib diisi.");

  const otp = crypto.randomInt(100000, 999999).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  const user = await User.findOne({ email: targetEmail });
  if (!user) throw new Error("User dengan email ini tidak ditemukan.");

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        otpCode: otp,
        otpExpiry: otpExpiry,
      },
    }
  );

  transporter
    .sendMail({
      from: `"${process.env.APP_NAME || "Antrikuy"}" <${
        process.env.EMAIL_SENDER
      }>`,
      to: targetEmail,
      subject: `${otp} - Kode Verifikasi`,
      html: `<p>Kode OTP Anda: <b>${otp}</b></p>`,
    })
    .catch((err) => console.error("🔥 EMAIL OTP ERROR:", err));
}

async function verifyOtpCode(target, otpCode) {
  let user = await User.findOne({ $or: [{ email: target }, { noHp: target }] });
  if (!user) throw new Error("Target user tidak ditemukan.");

  if (!user.otpCode || !user.otpExpiry) throw new Error("Kode OTP invalid.");
  if (user.otpExpiry < new Date()) throw new Error("Kode OTP kadaluarsa.");

  const storedOtp = String(user.otpCode).trim();
  const inputOtp = String(otpCode).trim();

  if (storedOtp !== inputOtp) throw new Error("Kode OTP salah.");

  return true;
}

async function resetPasswordWithOtp(target, otpCode, newPassword) {
  const user = await User.findOne({
    $or: [{ email: target }, { noHp: target }],
  });
  if (!user) throw new Error("User tidak ditemukan.");

  if (!user.otpCode || String(user.otpCode).trim() !== String(otpCode).trim()) {
    throw new Error("OTP tidak valid atau sudah kedaluwarsa.");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: hashedPassword,
        otpCode: null,
        otpExpiry: null,
      },
    }
  );
  return user;
}

async function findOrCreateUserFromFirebase(decodedToken, opsi = {}) {
  const { uid, email, phone_number } = decodedToken;
  const { biodata = {}, password } = opsi;

  if (!uid) throw new Error("Token Firebase tidak memiliki uid");

  let user = await User.findOne({ firebaseUid: uid });

  if (!user) {
    if (!password) throw new Error("Password wajib diisi saat registrasi");
    const passwordHash = await bcrypt.hash(password, 10);

    user = new User({
      firebaseUid: uid,
      email: email ? email.toLowerCase() : undefined,
      noHp: phone_number || biodata.noHp || undefined,
      passwordHash,
      metodeLoginAwal: biodata.metodeLoginAwal || null,
    });
  }

  if (biodata) applyBiodata(user, biodata);
  await user.save();
  return user;
}

async function exchangeCustomToken({ method, target, otpCode, firebaseUid }) {
  let user;
  if (method === "EMAIL") {
    user = await User.findOne({ email: target });
    if (!user) throw new Error("User tidak ditemukan.");
    if (
      !user.otpCode ||
      String(user.otpCode).trim() !== String(otpCode).trim()
    ) {
      throw new Error("OTP Salah/Invalid.");
    }
    await User.updateOne(
      { _id: user._id },
      { $set: { otpCode: null, otpExpiry: null } }
    );
  } else if (method === "PHONE") {
    user = await User.findOne({ noHp: target });
    if (!user) throw new Error("No HP tidak terdaftar.");
  }

  const customToken = await admin.auth().createCustomToken(user.firebaseUid);
  return { customToken, user };
}

async function validateUserPassword(input, password) {
  const isEmail = input.includes("@");
  const query = isEmail ? { email: input } : { noHp: input };
  const user = await User.findOne(query);

  if (!user) throw new Error("User tidak ditemukan.");

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) throw new Error("Password salah.");

  return user;
}

async function updateCurrentUserBiodata(userDoc, biodata = {}) {
  if (!userDoc || !userDoc.save) {
    throw new Error("Objek user tidak valid. Pastikan login berhasil.");
  }

  validateBiodataRequired(biodata);

  applyBiodata(userDoc, biodata);

  await userDoc.save();
  return userDoc;
}

async function syncUserPasswordToMongo(uid, currentPassword, newPassword) {
  const user = await User.findOne({ firebaseUid: uid });
  if (!user) {
    throw new Error("User tidak ditemukan di database.");
  }

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) {
    throw new Error("Password lama yang Anda masukkan salah.");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await User.updateOne(
    { firebaseUid: uid },
    {
      $set: { passwordHash: hashedPassword },
    }
  );

  return true;
}

async function sendOtpForEmailChange(uid, newEmail) {
  if (!newEmail || !newEmail.includes("@"))
    throw new Error("Format email tidak valid.");

  const existingUser = await User.findOne({ email: newEmail });
  if (existingUser)
    throw new Error("Email ini sudah digunakan oleh akun lain.");

  const user = await User.findOne({ firebaseUid: uid });
  if (!user) throw new Error("User tidak ditemukan.");

  const otp = crypto.randomInt(100000, 999999).toString();
  const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

  await User.updateOne(
    { _id: user._id },
    { $set: { otpCode: otp, otpExpiry } }
  );

  const mailOptions = {
    from: `"${process.env.APP_NAME || "Antrikuy"}" <${
      process.env.EMAIL_SENDER
    }>`,
    to: newEmail,
    subject: `Verifikasi Ganti Email - ${otp}`,
    html: `<h3>Permintaan Ganti Email</h3><p>Kode Verifikasi Anda: <b>${otp}</b></p>`,
  };
  await transporter.sendMail(mailOptions);
}

async function verifyAndChangeEmail(uid, newEmail, otpCode) {
  const user = await User.findOne({ firebaseUid: uid });
  if (!user) throw new Error("User tidak ditemukan.");

  if (!user.otpCode || !user.otpExpiry)
    throw new Error("Tidak ada permintaan OTP.");
  if (new Date() > user.otpExpiry) throw new Error("Kode OTP kadaluarsa.");
  if (String(user.otpCode).trim() !== String(otpCode).trim())
    throw new Error("Kode OTP Salah.");

  const existing = await User.findOne({ email: newEmail });
  if (existing) throw new Error("Email sudah digunakan akun lain.");

  try {
    await admin.auth().updateUser(uid, {
      email: newEmail.toLowerCase(),
      emailVerified: true,
    });

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          email: newEmail.toLowerCase(),
          otpCode: null,
          otpExpiry: null,
        },
      }
    );

    return user;
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      throw new Error("Email ini sudah terdaftar di sistem Firebase.");
    }
    throw new Error("Gagal sinkronisasi ke Firebase: " + error.message);
  }
}

async function sendOtpForPhoneChange(uid, newPhone) {
  if (!newPhone || newPhone.length < 10)
    throw new Error("Format nomor HP tidak valid.");

  const existingUser = await User.findOne({ noHp: newPhone });
  if (existingUser) throw new Error("Nomor HP ini sudah digunakan akun lain.");

  const user = await User.findOne({ firebaseUid: uid });
  if (!user) throw new Error("User tidak ditemukan.");

  const otp = crypto.randomInt(100000, 999999).toString();
  const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

  await User.updateOne(
    { _id: user._id },
    { $set: { otpCode: otp, otpExpiry } }
  );

  console.log(
    `[SIMULASI SMS] Kirim ke ${newPhone}: Kode OTP Anda adalah ${otp}`
  );
}

async function verifyAndChangePhone(uid, newPhone, otpCode) {
  const user = await User.findOne({ firebaseUid: uid });
  if (!user) throw new Error("User tidak ditemukan.");

  if (!user.otpCode || !user.otpExpiry)
    throw new Error("Tidak ada permintaan OTP.");
  if (new Date() > user.otpExpiry) throw new Error("Kode OTP kadaluarsa.");
  if (String(user.otpCode).trim() !== String(otpCode).trim())
    throw new Error("Kode OTP Salah.");

  const existing = await User.findOne({ noHp: newPhone });
  if (existing) throw new Error("Nomor HP sudah digunakan akun lain.");

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        noHp: newPhone,
        otpCode: null,
        otpExpiry: null,
      },
    }
  );

  return user;
}

async function generateTestToken(target) {
  const user = await User.findOne({
    $or: [{ email: target }, { noHp: target }],
  });

  if (!user) throw new Error("User testing tidak ditemukan.");

  const customToken = await admin.auth().createCustomToken(user.firebaseUid);
  return { customToken, user };
}

module.exports = {
  findOrCreateUserFromFirebase,
  updateCurrentUserBiodata,
  sendEmailOtp,
  verifyOtpCode,
  resetPasswordWithOtp,
  exchangeCustomToken,
  validateUserPassword,
  syncUserPasswordToMongo,
  sendOtpForEmailChange,
  verifyAndChangeEmail,
  sendOtpForPhoneChange,
  verifyAndChangePhone,
  generateTestToken,
};
