type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
};

export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
  return (
    <div className="page__head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page__title">{title}</h1>
        <p className="page__sub">{description}</p>
      </div>
      {action && <div className="page__actions">{action}</div>}
    </div>
  );
}
