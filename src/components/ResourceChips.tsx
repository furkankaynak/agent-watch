type Props = {
  label: string;
  items: string[];
};

export function ResourceChips({ label, items }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="resource-chips">
      <span className="resource-chips__label">{label}:</span>
      {items.map((item) => (
        <span key={item} className="resource-chips__chip">
          {item}
        </span>
      ))}
    </div>
  );
}