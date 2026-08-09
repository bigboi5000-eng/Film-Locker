import { Router, type IRouter } from "express";
import healthRouter from "./health";
import moviesRouter from "./movies";
import communityRouter from "./films/community";
import notificationsRouter from "./notifications";
import usersRouter from "./users";
import followsRouter from "./follows";
import playlistsRouter from "./playlists";

const router: IRouter = Router();

router.use(healthRouter);
router.use(moviesRouter);
router.use(communityRouter);
router.use(notificationsRouter);
router.use(usersRouter);
router.use(followsRouter);
router.use(playlistsRouter);

export default router;
