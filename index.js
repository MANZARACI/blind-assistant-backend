import express from "express";
import dotenv from "dotenv";
import ExpressError from "./utils/ExpressError.js";
import catchAsync from "./utils/catchAsync.js";
import cors from "cors";
import { isLoggedIn } from "./middleware.js";
import { db } from "./firebase.js";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import path from "path";
import faceapi from "face-api.js";
import { seedLocations } from "./utils/locationSeed.js";
import { User } from "./models/userModel.js";
import canvas, { Canvas, Image } from "canvas";
import fileUpload from "express-fileupload";
import fs from "fs";
import { Timestamp } from "firebase-admin/firestore";
faceapi.env.monkeyPatch({ Canvas, Image });

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port: ${PORT}`));

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(
  fileUpload({
    useTempFiles: true,
  })
);

const loadModels = async () => {
  await faceapi.nets.faceRecognitionNet.loadFromDisk(__dirname + "/aiModels");
  await faceapi.nets.faceLandmark68Net.loadFromDisk(__dirname + "/aiModels");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(__dirname + "/aiModels");
};

loadModels();

mongoose.connect(process.env.MDB_CONNECT, (err) => {
  if (err) return console.error(err);
  console.log("Connected to mongoDB");
});

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

//set location request
app.get(
  "/set-location-request",
  catchAsync(async (req, res, next) => {
    const deviceId = req.query.deviceId;

    if (!deviceId) {
      return next(new ExpressError("You must provide a device id!"));
    }

    const fetchUserIdRef = db.ref("device-user/" + deviceId);
    const userIdResult = await fetchUserIdRef.once("value");

    if (!userIdResult.exists()) {
      return next(new ExpressError("No user found with this device id!", 404));
    }

    const userId = userIdResult.val();

    const setLocationRequestRef = db.ref(
      "users/" + userId + "/locationRequest"
    );
    setLocationRequestRef.set(true);

    return res.status(200).send("Successful");
  })
);

//new location
app.post(
  "/location",
  isLoggedIn,
  catchAsync(async (req, res, next) => {
    const { lat, lng } = req.body;
    const userId = req.uid;

    const fetchDeviceIdRef = db.ref("users/" + userId + "/deviceId");
    const deviceIdResult = await fetchDeviceIdRef.once("value");

    if (!deviceIdResult.exists()) {
      return next(new ExpressError("You don't have a device id!", 404));
    }

    const deviceId = deviceIdResult.val();

    const locationsRef = db.ref("devices/" + deviceId);

    const location = {
      lat,
      lng,
      time: Timestamp.now(),
    };

    locationsRef.push(location);

    const removeLocationRequestRef = db.ref(
      "users/" + userId + "/locationRequest"
    );
    removeLocationRequestRef.set(null);

    return res.status(200).send("Location sent");
  })
);

//reset detected faces
app.post(
  "/reset-detected-faces",
  isLoggedIn,
  catchAsync(async (req, res, next) => {
    const userId = req.uid;

    const resetDetectedFacesRef = db.ref("users/" + userId + "/detectedFaces");
    resetDetectedFacesRef.set(null);

    return res.status(200).send("Successful");
  })
);

//recognise face
app.post(
  "/recognise-face",
  catchAsync(async (req, res, next) => {
    const deviceId = req.query.deviceId;

    const imageType = req.files.imageFile.mimetype.replace("image/", ".");
    const imagePath = req.files.imageFile.tempFilePath + imageType;

    fs.renameSync(req.files.imageFile.tempFilePath, imagePath);

    const fetchUserIdRef = db.ref("device-user/" + deviceId);
    const userIdResult = await fetchUserIdRef.once("value");
    const userId = userIdResult.val();

    const existingUser = await User.findOne({ userId });
    if (!existingUser) {
      return next(new ExpressError("No user found.", 401));
    }

    let faces = existingUser.faces;
    let transformed_faces = [];

    for (let i = 0; i < faces.length; i++) {
      //Change the face data descriptors from Objects to Float32Array type
      for (let j = 0; j < faces[i].descriptions.length; j++) {
        faces[i].descriptions[j] = new Float32Array(
          Object.values(faces[i].descriptions[j])
        );
      }

      transformed_faces[i] = new faceapi.LabeledFaceDescriptors(
        faces[i].label,
        faces[i].descriptions
      );
    }

    const faceMatcher = new faceapi.FaceMatcher(transformed_faces, 0.6); // set distance threshold to 0.6 (if result is more than the threshold no result will be provided)

    //Read the image using canvas
    const img = await canvas.loadImage(imagePath);
    const temp = faceapi.createCanvasFromMedia(img);

    //Process the image for the model
    const displaySize = { width: img.width, height: img.height };
    faceapi.matchDimensions(temp, displaySize);

    //Find matching faces
    const detections = await faceapi
      .detectAllFaces(img)
      .withFaceLandmarks()
      .withFaceDescriptors();
    const resizedDetections = faceapi.resizeResults(detections, displaySize);
    const results = resizedDetections.map((d) =>
      faceMatcher.findBestMatch(d.descriptor)
    );

    fs.unlinkSync(imagePath);

    const labelList = results.map((result) => {
      return result.label;
    });

    const detectedFacesRef = db.ref("users/" + userId + "/detectedFaces");
    detectedFacesRef.set(labelList);

    return res.status(200).json({ results });
  })
);

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

//new face with base64 encoding
app.post(
  "/new-face-base64",
  isLoggedIn,
  catchAsync(async (req, res, next) => {
    const { encoded, encoded2, encoded3, label } = req.body;
    const userId = req.uid;

    const File1 = Buffer.from(encoded, "base64");
    const File2 = Buffer.from(encoded2, "base64");
    const File3 = Buffer.from(encoded3, "base64");

    const images = [File1, File2, File3];

    let existingUser = await User.findOne({ userId });

    if (!existingUser) {
      existingUser = new User({
        userId,
      });

      await existingUser.save();
    }

    let counter = 0;
    const descriptions = [];

    //loop through the images
    for (let i = 0; i < images.length; i++) {
      const img = await canvas.loadImage(images[i]);
      counter = (i / images.length) * 100;
      console.log(`Progress - ${counter}%`);

      const detections = await faceapi
        .detectSingleFace(img)
        .withFaceLandmarks()
        .withFaceDescriptor();

      descriptions.push(detections.descriptor);
    }

    const face = {
      label,
      descriptions,
    };

    existingUser.faces.push(face);
    await existingUser.save();
    return res.status(200).json({
      successMessage: "Successfully updated",
    });
  })
);

//get faces
app.get(
  "/faces",
  catchAsync(async (req, res, next) => {
    const userId = req.query.userId;

    let user = await User.findOne({ userId });

    if (!user) {
      user = new User({ userId });

      await user.save();
    }

    const faceArray = [];
    user.faces.forEach((face) => {
      faceArray.push({ id: face._id, label: face.label });
    });

    return res.status(200).json({ faceArray });
  })
);

//delete face
app.post(
  "/delete-face",
  isLoggedIn,
  catchAsync(async (req, res, next) => {
    const { faceId } = req.body;
    const userId = req.uid;

    const user = await User.findOne({ userId });

    if (!user) {
      return next(new ExpressError("No user found.", 401));
    }

    await user.updateOne({ $pull: { faces: { _id: faceId } } });

    return res.status(200).send("Successfully deleted");
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
