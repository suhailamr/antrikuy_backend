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
      type: String,
      enum: ["pending", "approved", "rejected", "left", "blocked"],
      default: "pending",
    },
    role: {
      type: String,

      enum: ["student", "parent", "teacher", "admin", "other"],
      default: "student",
    },

    nip: {
      type: String,
      trim: true,
      default: null,
    },
    adminRequestStatus: {
      type: String,
      enum: ["NONE", "PENDING", "APPROVED", "REJECTED"],
      default: "NONE",
    },
    adminRequestDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

schoolMemberSchema.index({ school: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("SchoolMember", schoolMemberSchema);
