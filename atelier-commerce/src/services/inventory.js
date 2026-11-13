import { db,get,run } from '../db.js';
import { id,now } from '../utils/index.js';

export function addOrderEvent(orderId,status,note=''){run('INSERT INTO order_events(id,order_id,status,note,created_at) VALUES(?,?,?,?,?)',id(),orderId,status,note,now());}
export function restoreStock(orderNo) {
  const order=get('SELECT * FROM orders WHERE order_no=?',orderNo);
  if(!order||order.stock_restored)return false;
  const items=db.prepare('SELECT variant_id,qty FROM order_items WHERE order_id=?').all(order.id);
  db.transaction(()=>{for(const item of items)if(item.variant_id)run('UPDATE variants SET stock=stock+? WHERE id=?',item.qty,item.variant_id);run('UPDATE orders SET stock_restored=1,updated_at=? WHERE id=?',now(),order.id);})();
  addOrderEvent(order.id,'STOCK_RESTORED','Inventory returned to stock');return true;
}
export function orderDto(order) {
  if(!order)return null;
  return {...order,items:db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id),events:db.prepare('SELECT status,note,created_at FROM order_events WHERE order_id=? ORDER BY created_at').all(order.id)};
}