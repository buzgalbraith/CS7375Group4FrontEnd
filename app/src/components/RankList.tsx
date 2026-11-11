import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function Item({
  id,
  name,
  rank,
  onMove,
  last,
}: {
  id: string;
  name: string;
  rank: number;
  last: boolean;
  onMove: (d: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      className={`rank-item ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className="rank-num">{rank}</span>
      <span className="rank-handle" {...attributes} {...listeners}>
        ⠿ {name}
      </span>
      <span className="rank-btns">
        <button aria-label={`Move ${name} up`} disabled={rank === 1} onClick={() => onMove(-1)}>
          ▲
        </button>
        <button aria-label={`Move ${name} down`} disabled={last} onClick={() => onMove(1)}>
          ▼
        </button>
      </span>
    </li>
  );
}

/** `items` are the stable labels (A, B, …) stored in the data; `names` is what participants see for each. */
export function RankList({
  items,
  names,
  onChange,
}: {
  items: string[];
  names: Record<string, string>;
  onChange: (items: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id)
      onChange(arrayMove(items, items.indexOf(String(active.id)), items.indexOf(String(over.id))));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ol className="rank-list">
          {items.map((id, i) => (
            <Item
              key={id}
              id={id}
              name={names[id] ?? `Explanation ${id}`}
              rank={i + 1}
              last={i === items.length - 1}
              onMove={(d) => onChange(arrayMove(items, i, i + d))}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
