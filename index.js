import express from "express";
import dotenv from "dotenv";
import ExpressError from "./utils/ExpressError.js";
import catchAsync from "./utils/catchAsync.js";
import cors from "cors";
import { isLoggedIn } from "./middleware.js";
import { db } from "./firebase.js";

import { seedLocations } from "./utils/locationSeed.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port: ${PORT}`));

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server is working");
});

app.get("/seedLocation", (req, res) => {
  const { lat, lng } = req.query;
  const location = {
    lat: Number(lat),
    lng: Number(lng),
  };
  seedLocations(location);
});

//change device id
app.post(
  "/deviceId",
  isLoggedIn,
  catchAsync(async (req, res, next) => {
    const { newDeviceId } = req.body;
    const userId = req.uid;

    // device id validation
    if (newDeviceId.length !== 6) {
      return next(new ExpressError("Device id must be 6 characters!"));
    }

    // check if the provided id has been already owned
    const checkDeviceIdOwnerRef = db.ref("device-user/" + newDeviceId);
    const isOwned = await checkDeviceIdOwnerRef.once("value");
    if (isOwned.exists()) {
      return next(new ExpressError("This id is already owned!", 409));
    }

    // remove ownership from the old device id
    const checkOlderDeviceIdRef = db.ref("users/" + userId + "/deviceId");
    const result = await checkOlderDeviceIdRef.once("value");
    if (result.exists()) {
      db.ref("device-user/" + result.val()).set(null);
    }

    // set new ownership of the device id
    checkOlderDeviceIdRef.set(newDeviceId);
    checkDeviceIdOwnerRef.set(userId);

    return res.status(200).json({
      successMessage: "Successfully updated",
    });
  })
);

app.all("*", (req, res, next) => {
  next(new ExpressError("Path Not Found", 404));
});

app.use((err, req, res, next) => {
  const { statusCode = 500 } = err;

  if (!err.message) {
    err.message = "Something went wrong!";
  }
  res.status(statusCode).json({
    errorMessage: err.message,
  });
});
