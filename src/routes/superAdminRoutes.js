const express = require("express");
const router = express.Router();
const superAdminController = require("../controllers/superAdminController");
const { protect, authorize } = require("../middleware/authMiddleware");

const superAdminOnly = [protect, authorize("SUPER_ADMIN")];
const researcherAndAdmin = [protect, authorize("SUPER_ADMIN", "PENELITI")];

router.get(
  "/schools/pending",
  researcherAndAdmin,
  superAdminController.getPendingSchools
);
router.get(
  "/schools/all",
  researcherAndAdmin,
  superAdminController.getAllSchools
);
router.get(
  "/schools/:schoolId",
  researcherAndAdmin,
  superAdminController.getSchoolById
);
router.get(
  "/schools/:schoolId/members",
  researcherAndAdmin,
  superAdminController.getSchoolMembers
);

router.post(
  "/schools/review",
  researcherAndAdmin,
  superAdminController.reviewSchoolRequest
);

router.post(
  "/schools/:schoolId/request-dissolve",
  protect,
  superAdminController.requestSchoolDissolution
);

router.get(
  "/dissolve-requests/pending",
  protect,
  authorize("SUPER_ADMIN"),
  superAdminController.getPendingDissolutions
);

router.post(
  "/approve-dissolve/:requestId",
  superAdminOnly,
  superAdminController.approveDissolution
);
router.post(
  "/reject-dissolve/:requestId",
  superAdminOnly,
  superAdminController.rejectDissolution
);

module.exports = router;
