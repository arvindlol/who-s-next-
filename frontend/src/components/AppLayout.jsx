import { NavLink } from 'react-router-dom'
import Brand from './Brand.jsx'
import { useAuth } from '../auth.jsx'
import { getInitials } from '../utils/format.js'

const NAV_ITEMS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/jobs', label: 'Jobs' },
  { to: '/candidates', label: 'Candidates' },
  { to: '/screening', label: 'Screening' },
  { to: '/interviews', label: 'Interviews' },
  { to: '/reports', label: 'Reports' },
]

/** Shared page frame: top navigation, main content and footer. */
export default function AppLayout({
  children,
  mainClassName = 'page',
  footer = 'Who’s Next assists interviewers. Hiring decisions stay with you.',
}) {
  const { user, signOut } = useAuth()

  const handleSignOut = () => {
    signOut().catch(error => console.error('Sign out failed:', error?.code || error))
  }

  return (
    <div className="shell">
      <header className="topbar glass glass--strong">
        <Brand />
        <nav aria-label="Main">
          {NAV_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>
          ))}
        </nav>
        <span className="spacer" />
        <NavLink to="/profile" className="avatar" title={user?.email} aria-label="Your profile">
          {getInitials(user?.name || user?.email || 'U')}
        </NavLink>
        <button type="button" className="btn btn--ghost" onClick={handleSignOut}>Log out</button>
      </header>

      <main className={mainClassName}>{children}</main>

      {footer && <footer className="footer">{footer}</footer>}
    </div>
  )
}
