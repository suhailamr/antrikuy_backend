const express = require("express");
const router = express.Router();
const schoolController = require("../controllers/schoolController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.get("/", protect, schoolController.listSchools);
router.get("/my", protect, schoolController.getMySchoolStatus);

router.post("/request", protect, schoolController.requestNewSchool);

router.get("/dashboard-admin", protect, schoolController.getAdminStats);
router.post(
  "/leave",
  protect,
  authorize("ADMIN", "PENGGUNA"),
  schoolController.leaveSchool
);
router.post("/:schoolId/join", protect, schoolController.joinSchool);
router.post(
  "/:schoolId/cancel-request",
  protect,
  schoolController.cancelJoinRequest
);

router.get(
  "/members",
  protect,
  authorize("ADMIN", "SUPER_ADMIN"),
  schoolController.listMembers
);
router.put(
  "/members/:membershipId/status",
  protect,
  authorize("ADMIN", "SUPER_ADMIN"),
  schoolController.updateMemberStatus
);
router.put(
  "/admin-request/respond",
  protect,
  authorize("ADMIN", "SUPER_ADMIN"),
  schoolController.approveAdminRequest
);

module.exports = router;
