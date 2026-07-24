import { Wrench } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';

type PlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  nextStep: string;
};

export function PlaceholderPage({ eyebrow, title, description, nextStep }: PlaceholderPageProps) {
  return (
    <div className="page-stack">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <section className="panel empty-state">
        <span className="empty-state__icon"><Wrench size={21} /></span>
        <div>
          <h2 className="panel__title">Foundation ready</h2>
          <p>{nextStep}</p>
        </div>
      </section>
    </div>
  );
}
