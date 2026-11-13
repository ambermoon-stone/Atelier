import { z } from 'zod';

const sanitize=value=>Array.isArray(value)?value.map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitize(item)])):typeof value==='string'?value.replace(/[<>]/g,'').trim():value;
export function validate(schema,source='body') {
  return (req,res,next)=>{
    const parsed=schema.safeParse(sanitize(req[source]||{}));
    if(!parsed.success)return res.status(400).json({error:'VALIDATION',details:parsed.error.flatten()});
    req.validated=parsed.data;next();
  };
}
export { z };