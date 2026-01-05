const mongoose = require("mongoose");

const schoolMemberSchema = new mongoose.Schema(
  {
    school: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      // Status keanggotaan umum (masuk sekolah)
      type: String,
      enum: ["pending", "approved", "rejected", "left", "blocked"],
      default: "pending",
    },
    role: {
      // Peran di dalam sekolah
      type: String,
      // 🔥 UPDATE: Tambahkan 'admin' dan 'teacher' di sini
      enum: ["student", "parent", "teacher", "admin", "other"],
      default: "student",
    },

    // --- 🔥 BAGIAN BARU: FITUR REQUEST ADMIN ---
    nip: {
      type: String,
      trim: true,
      default: null, // Menyimpan NIP / NUPTK
    },
    adminRequestStatus: {
      type: String,
      enum: ["NONE", "PENDING", "APPROVED", "REJECTED"],
      default: "NONE", // Status pengajuan hak admin
    },
    adminRequestDate: {
      type: Date,
      default: null, // Kapan dia mengajukan
    },
  },
  {
    timestamps: true,
  }
);

// Mencegah user join sekolah yang sama lebih dari sekali
schoolMemberSchema.index({ school: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("SchoolMember", schoolMemberSchema);
