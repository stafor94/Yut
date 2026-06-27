import { BOARD_NODES, spawnInitialBoardItems } from '../../../game-core/board/board';
import { ITEM_DEFINITIONS } from '../../items/logic/items';

const previewItems = spawnInitialBoardItems(6, 6);

export function GameBoard() {
  return <div className="board" aria-label="윷놀이 말판 미리보기">
    {BOARD_NODES.map((node) => {
      const item = previewItems.find((boardItem) => boardItem.nodeId === node.id);
      return <div key={node.id} className={`board-node ${node.kind}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} title={node.id}>
        {item ? <span className="board-item">{ITEM_DEFINITIONS[item.type].name.slice(0, 2)}</span> : null}
      </div>;
    })}
    <div className="piece red">윷</div><div className="piece blue">놀이</div>
  </div>;
}
