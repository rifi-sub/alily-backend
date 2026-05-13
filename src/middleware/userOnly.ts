import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

export interface UserRequest extends Request {
  user?: any;
}

export default async function userOnly(req: UserRequest, res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = auth.slice(7);
    
    // Verify token with Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
