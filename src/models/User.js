const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    sekolah: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: false,
    },

    firebaseUid: {
      type: String,
      required: true,
      unique: true,
    },

    fcmToken: {
      type: String,
      default: null,
    },

    metodeLoginAwal: {
      type: String,
      enum: ["EMAIL", "PHONE"],
      required: false,
    },

    email: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },

    noHp: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    otpCode: {
      type: String,
      default: null,
    },

    otpExpiry: {
      type: Date,
      default: null,
    },

    namaPengguna: {
      type: String,
      required: false,
    },

    peran: {
      type: String,
      enum: ["PENGGUNA", "ADMIN", "SUPER_ADMIN", "PENELITI"],
      default: "PENGGUNA",
    },

    nis: {
      type: String,
      unique: true,
      sparse: true,
      required: false,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^\d{10,16}$/.test(v);
        },
        message: (props) =>
          `${props.value} bukan format NIS/NUPTK yang valid! Harus 10-16 digit angka.`,
      },
    },

    tempatLahir: {
      type: String,
      required: false,
    },

    tanggalLahir: {
      type: Date,
      required: false,
    },

    kategoriSekolah: {
      type: String,
      enum: ["SD", "SMP", "SMA", "SMK", "UMUM"],
      required: false,
    },

    kelas: {
      type: String,
      required: false,
    },

    jurusan: {
      type: String,
      required: false,
    },

    namaOrangTua: {
      type: String,
      required: false,
    },

    diwakiliOrangTua: {
      type: Boolean,
      default: false,
    },

    alamat: {
      type: String,
      required: false,
    },

    idSekolah: {
      type: String,
      default: null,
    },

    fotoProfil: {
      type: String,
      default: null,
    },

    fotoSampul: {
      type: String,
      default: null,
    },

    adminRequestStatus: {
      type: String,
      enum: ["NONE", "PENDING", "APPROVED", "REJECTED"],
      default: "NONE",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", UserSchema);
