const express = require("express");
const router = express.Router();
const eventController = require("../controllers/eventController");
const { protect } = require("../middleware/authMiddleware");

router.post("/", protect, eventController.createEvent);
router.get("/", protect, eventController.getAllEvents);
router.put("/:id", protect, eventController.updateEvent);
router.delete("/:id", protect, eventController.deleteEvent);

router.put("/:eventId/lock", protect, eventController.toggleEventLock);

module.exports = router;