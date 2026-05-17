export default function Logo({ small = false }) {
  return (
    <div className={`logo${small ? ' logo--sm' : ''}`}>
      <span className="logo__icon">HT</span>
      <span className="logo__text">House Tenerife</span>
    </div>
  );
}
