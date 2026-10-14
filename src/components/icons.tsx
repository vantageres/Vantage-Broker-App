// Stroke icons from the Claude Design canvas.
type P = { size?: number };
const svg = (size: number, children: React.ReactNode, width = 2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const History = ({ size = 22 }: P) => svg(size, <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>);
export const Back = ({ size = 22 }: P) => svg(size, <path d="M15 6l-6 6 6 6" />, 2.4);
export const Send = ({ size = 22 }: P) => svg(size, <path d="M12 19V5M5 12l7-7 7 7" />, 2.4);
export const Pencil = ({ size = 16 }: P) => svg(size, <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>);
export const Note = ({ size = 16 }: P) => svg(size, <path d="M5 4h14v16H5zM9 9h6M9 13h6" />);
export const Lock = ({ size = 18 }: P) => svg(size, <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const UserPlus = ({ size = 18 }: P) => svg(size, <><circle cx="10" cy="8" r="4" /><path d="M3 20c1-4 4-6 7-6s6 2 7 6M19 8v6M16 11h6" /></>);
export const Alert = ({ size = 18 }: P) => svg(size, <><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.5" /></>);
export const Bolt = ({ size = 16 }: P) => svg(size, <path d="M13 3L5 14h6l-1 7 8-11h-6z" />);
export const Out = ({ size = 14 }: P) => svg(size, <path d="M7 17L17 7M9 7h8v8" />, 2.4);
export const Chevron = ({ size = 20 }: P) => svg(size, <path d="M9 6l6 6-6 6" />, 2.4);
export const Plus = ({ size = 18 }: P) => svg(size, <path d="M12 5v14M5 12h14" />, 2.4);
export const Check = ({ size = 14 }: P) => svg(size, <path d="M5 12l5 5 9-10" />, 3);
