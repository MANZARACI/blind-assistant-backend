import { auth } from "./firebase.js";
import ExpressError from "./utils/ExpressError.js";

export const isLoggedIn = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    const decodedToken = await auth.verifyIdToken(idToken);
    req.uid = decodedToken.uid;

    next();
  } catch (error) {
    next(new ExpressError("Authentication failed!", 401));
  }
};
