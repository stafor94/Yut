import { ITEM_DEFINITIONS, type ItemType } from '../logic/items';

export function ItemCard({ type }: { type: ItemType }) {
  const item = ITEM_DEFINITIONS[type];
  return <article className="item-card"><strong>{item.name}</strong><span>{item.description}</span><small>{item.timing}</small></article>;
}
