import { Router, type IRouter } from "express";
import healthRouter from "./health";
import moviesRouter from "./movies";
import communityRouter from "./films/community";

const router: IRouter = Router();

router.use(healthRouter);
router.use(moviesRouter);
router.use(communityRouter);

export default router;
