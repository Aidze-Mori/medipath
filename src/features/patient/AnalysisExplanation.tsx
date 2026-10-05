import { FileText } from 'lucide-react';
import type { Analysis } from '../../domain';
export function AnalysisExplanation({ analysis, title }: { analysis: Analysis; title?: string }) {
  if (!analysis.llmExplanation) return null;
  const labels = { description: 'Описание', conclusion: 'Заключение', recommendations: 'Рекомендации', unclassified: 'Другие сведения' };
  const sections = ['description', 'conclusion', 'recommendations', 'unclassified'] as const;
  return <section className="panel analysis-explanation" aria-label="AI-пояснение документа">
    <div className="analysis-explanation-heading"><FileText size={20} aria-hidden="true" /><div><p className="eyebrow">Понятно о результате</p>{title && <p className="small muted analysis-document-title">{title}</p>}</div></div>
    <p className="analysis-summary">{analysis.llmExplanation.summary}</p>
    <div className="analysis-section-cards">{sections.map(section => {
      const findings = analysis.llmExplanation!.findings.filter(finding => finding.sectionId === section);
      if (!findings.length) return null;
      return <details className="analysis-section-card" key={section}><summary><strong>{labels[section]}</strong><span className="analysis-card-preview">{findings[0].explanation}</span><span className="analysis-card-action" aria-hidden="true">Подробнее</span></summary><div className="analysis-card-content">{findings.map((finding, index) => <div className="analysis-finding" key={index}><p>{finding.explanation}</p><details><summary>Сверить с исходным текстом</summary><blockquote>{finding.quote}</blockquote></details></div>)}</div></details>;
    })}</div>
    <p className="small muted analysis-disclaimer">AI поясняет очищенный текст документа. Это не диагноз и не врачебная проверка.</p>
  </section>;
}
