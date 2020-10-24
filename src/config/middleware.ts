import * as express from 'express';
import {env} from 'process';

export function allowIp(req: express.Request, res: express.Response, next: Function) {
    if (!env.IP_WHITELIST)
        next();

    const whitelist = env.IP_WHITELIST.split(',');
    const ip = req.ip;
    
    const allowed = whitelist.some(whitelistedIp => ip.indexOf(whitelistedIp) != -1);

    if (!allowed)
        res.sendStatus(403);
    else 
        next();
}
