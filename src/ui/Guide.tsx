import { UNLOCK_TICK, type TutorialStep } from "../sim";

const CONCEPTS: { icon: string; title: string; text: string }[] = [
  { icon: "🪙", title: "Money is debt", text: "All money is created by a logged event: Monetization, a loan, or a Grant, and destroyed when loans are repaid or written off. Watch the Money flow statistics to see it happen." },
  { icon: "🌾", title: "The core loop", text: "Create money, lend it to Industries so they hire and produce, give Grants so Households can buy, then watch hunger fall. Wages and sales carry the money around the loop." },
  { icon: "🏭", title: "Industries", text: "Each Industry hires workers, pays wages, buys inputs and sells Products. If it cannot afford workers for long it fails; a new Industry Loan restarts it." },
  { icon: "🔬", title: "Research", text: "Pick Technologies in the Research menu. The Treasury pays the Research Labs for points. Technologies unlock Products and Industries, add output bonuses and open more Research slots." },
  { icon: "🧾", title: "Taxes and debt", text: `From Day ${UNLOCK_TICK.taxes} you can tax income and profit, sell Government debt, pay pensions and fund healthcare and education.` },
  { icon: "🏦", title: "The Central Bank", text: `From Day ${UNLOCK_TICK.policyRate} you set the Policy Rate, which feeds through to the Commercial Bank's lending rates.` },
  { icon: "📈", title: "Prices and inflation", text: "Prices come from a call auction of what buyers will pay against what is for sale. Too much money chasing too few Products pushes the price index up." },
  { icon: "⏱️", title: "Time", text: "One Tick is one in-game day. Commands you give are queued and take effect on the next day, so unpause or step to see them land." },
];

export function Guide({ tutorial }: { tutorial: TutorialStep[] }) {
  const next = tutorial.find((t) => !t.done);
  return (
    <div className="guide">
      <h3>Quest log</h3>
      <ol className="quests">
        {tutorial.map((t) => (
          <li key={t.id} className={t.done ? "done" : t === next ? "now" : ""}>{t.text}</li>
        ))}
      </ol>
      <h3>How the economy works</h3>
      <div className="concepts">
        {CONCEPTS.map((c) => (
          <article key={c.title} className="concept">
            <div className="concept-icon" aria-hidden>{c.icon}</div>
            <div><h4>{c.title}</h4><p>{c.text}</p></div>
          </article>
        ))}
      </div>
      <p className="note">Every term is defined in GLOSSARY.md in the repository.</p>
    </div>
  );
}
