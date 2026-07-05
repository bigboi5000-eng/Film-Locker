import { Router, type IRouter } from "express";
import healthRouter from "./health";
import moviesRouter from "./movies";

const router: IRouter = Router();

router.use(healthRouter);
router.use(moviesRouter);

export default router;
