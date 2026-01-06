const express = require("express");
const router = express.Router();
const queueController = require("../controllers/queueController");
const { protect } = require("../middleware/authMiddleware");

router.get("/my", protect, queueController.getMyQueues);
router.get("/check-event/:code", protect, queueController.checkEventBeforeJoin);
router.post("/join", protect, queueController.joinQueue);
router.post("/join/:eventId", protect, queueController.joinQueue);
router.post("/cancel/:queueId", protect, queueController.userCancelQueue);
router.put("/:queueId/postpone", protect, queueController.userPostponeQueue);

router
  .route("/:queueId/refresh-qr")
  .get(protect, queueController.refreshQrToken)
  .post(protect, queueController.refreshQrToken);

router.post("/validate-qr", protect, queueController.validateQrAndStartService);

router.get(
  "/event/:eventId/dashboard",
  protect,
  queueController.getAdminDashboard
);
router.get("/list", protect, queueController.getQueueListByEvent);
router.post("/admin/call-next", protect, queueController.adminCallNext);

router.post(
  "/admin/cancel-user-all",
  protect,
  queueController.cancelAllQueuesByUser
);

router
  .route("/admin/skip")
  .post(protect, queueController.adminSkipQueue)
  .put(protect, queueController.adminSkipQueue);

router
  .route("/admin/finish")
  .post(protect, queueController.adminCompleteQueue)
  .put(protect, queueController.adminCompleteQueue);

router.post("/admin/serve-manual", protect, queueController.adminServeQueue);
router.put(
  "/admin/:queueId/respond-postpone",
  protect,
  queueController.adminRespondPostpone
);

router.post("/seed", protect, queueController.seedQueue);

router.get("/:queueId", protect, async (req, res, next) => {
  const reserved = [
    "my",
    "list",
    "seed",
    "join",
    "admin",
    "event",
    "validate-qr",
    "check-event",
    "export",
  ];
  if (reserved.includes(req.params.queueId)) return next();
  await queueController.getQueueDetail(req, res);
});
router.post("/admin/reset-counter", protect, queueController.resetQueueCounter);

router.get(
  "/admin/export/:eventId",
  protect,
  queueController.exportQueueToExcel
);

module.exports = router;
