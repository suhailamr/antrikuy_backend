const mongoose = require("mongoose");

const queueEntrySchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    pengguna: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    nomorAntrian: {
      type: Number,
      required: true,
    },

    batch: {
      type: Number,
      default: 1,
      required: true,
    },
    statusAntrian: {
      type: String,

      enum: [
        "MENUNGGU",
        "DIPANGGIL",
        "DILAYANI",
        "SELESAI",
        "DIBATALKAN",
        "TERLEWAT",
        "REQ_TUNDA",
      ],
      default: "MENUNGGU",
      required: true,
    },

    waktuKadaluarsa: {
      type: Date,
      default: null,
    },

    waktuMulaiPelayanan: { type: Date, default: null },
    waktuSelesaiPelayanan: { type: Date, default: null },

    alasanBatal: { type: String, default: null },
    alasanTunda: { type: String, default: null },

    qrToken: { type: String },
    qrExpiresAt: { type: Date },

    dilewatiCount: { type: Number, default: 0 },
    isPostponed: { type: Boolean, default: false },

    waktuDaftar: { type: Date, default: Date.now },
    waktuDipanggil: { type: Date },
    waktuMulaiLayanan: { type: Date },
    waktuSelesaiLayanan: { type: Date },
    waktuSelesai: { type: Date },
  },
  { timestamps: true }
);

queueEntrySchema.index(
  { event: 1, batch: 1, nomorAntrian: 1 },
  { unique: true }
);

const QueueEntry = mongoose.model("QueueEntry", queueEntrySchema);
module.exports = QueueEntry;
