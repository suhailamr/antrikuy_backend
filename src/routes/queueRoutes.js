const express = require("express");
const router = express.Router();
const queueController = require("../controllers/queueController");
const { protect } = require("../middleware/authMiddleware");

// --- FITUR PENGGUNA ---
router.get("/my", protect, queueController.getMyQueues);
router.get(
  "/check-event/:code",
  protect,
  queueController.checkEventBeforeJoin
);
router.post("/join", protect, queueController.joinQueue);
router.post("/join/:eventId", protect, queueController.joinQueue);
router.post(
  "/cancel/:queueId",
  protect,
  queueController.userCancelQueue
); //
router.put(
  "/:queueId/postpone",
  protect,
  queueController.userPostponeQueue
); //

// --- FITUR TOKEN & QR ---
router
  .route("/:queueId/refresh-qr")
  .get(protect, queueController.refreshQrToken) //
  .post(protect, queueController.refreshQrToken); //

router.post(
  "/validate-qr",
  protect,
  queueController.validateQrAndStartService
); //

// --- FITUR ADMIN / OPERASIONAL ---
router.get(
  "/event/:eventId/dashboard",
  protect,
  queueController.getAdminDashboard
); //
router.get("/list", protect, queueController.getQueueListByEvent); //
router.post(
  "/admin/call-next",
  protect,
  queueController.adminCallNext
); //

router.post(
  "/admin/cancel-user-all",
  protect,
  queueController.cancelAllQueuesByUser
);

router
  .route("/admin/skip")
  .post(protect, queueController.adminSkipQueue) //
  .put(protect, queueController.adminSkipQueue); //

router
  .route("/admin/finish")
  .post(protect, queueController.adminCompleteQueue) //
  .put(protect, queueController.adminCompleteQueue); //

router.post(
  "/admin/serve-manual",
  protect,
  queueController.adminServeQueue
); //
router.put(
  "/admin/:queueId/respond-postpone",
  protect,
  queueController.adminRespondPostpone
); //

// --- SISTEM & TESTING ---
router.post("/seed", protect, queueController.seedQueue); //


// --- DETAIL ANTREAN ---
// Ditaruh paling bawah agar tidak memblokir rute statis di atas
router.get("/:queueId", protect, async (req, res, next) => {
  const reserved = [
    "my",
    "list",
    "seed",
    "join",
    "admin",
    "event",
    "validate-qr",
  ];
  if (reserved.includes(req.params.queueId)) return next();
  await queueController.getQueueDetail(req, res); //
});
router.post(
  "/admin/reset-counter",
  protect, // <--- UBAH INI (Sesuaikan dengan nama variabel di file Anda)
  queueController.resetQueueCounter
);

router.get('/admin/export/:eventId', protect, queueController.exportQueueToExcel);

module.exports = router;
