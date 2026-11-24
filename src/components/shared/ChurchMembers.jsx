import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Alert, Btn, PageSkeleton, SearchInput, StatusBadge } from './UI';
import '../../styles/church-members.css';

const directory = '/app/members';
const fields = [
  ['Phone', 'phone'], ['Email', 'email'], ['Date of birth', 'date_of_birth'],
  ['Address', 'address'], ['Department', 'department'], ['KDF area', 'kdf_area'],
  ['KDF coordinator', 'kdf_coordinator'], ['Affinity group', 'affinity_group'],
  ['Spiritual status', 'spiritual_status'], ['Notes', 'notes'],
];

function useDirectoryRequest(path) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let active = true;
    apiRequest(path).then(data => { if (active) setResult({ path, data }); })
      .catch(error => { if (active) setResult({ path, error: error.message }); });
    return () => { active = false; };
  }, [path]);
  return result?.path === path ? result : null;
}

function MemberList() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [query, setQuery] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const result = useDirectoryRequest(`/church-members?${new URLSearchParams({ q: query, page })}`);
  const detailSearch = params.toString();
  const goToPage = next => setParams({ ...(search ? { q: search } : {}), ...(next > 1 ? { page: next } : {}) });
  return (
    <section className="church-directory" aria-labelledby="church-directory-title">
      <h1 className="display" id="church-directory-title">Church Members</h1>
      <SearchInput value={search} onChange={value => setParams(value ? { q: value } : {}, { replace: true })} placeholder="Search by name" />
      {query !== search || !result ? <p role="status">Loading members…</p> : result.error ? <Alert type="error" message={result.error} /> : (
        <>
          {result.data.items.length ? (
            <ul className="church-directory-list" aria-label="Member names">
              {result.data.items.map(member => (
                <li key={member.id}>
                  <Link to={{ pathname: `${directory}/${encodeURIComponent(member.id)}`, search: detailSearch }}>
                    {member.name}<ChevronRight size={18} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p role="status">{search.trim() ? 'No matching members.' : 'No church members on this page.'}</p>}
          {(page > 1 || result.data.hasMore) && (
            <nav className="church-directory-pages" aria-label="Member list pages">
              <Btn variant="outline" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous</Btn>
              <span>Page {page}</span>
              <Btn variant="outline" disabled={!result.data.hasMore} onClick={() => goToPage(page + 1)}>Next</Btn>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function MemberDetails({ memberId }) {
  const { search } = useLocation();
  const result = useDirectoryRequest(`/church-members/${encodeURIComponent(memberId)}`);
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [result?.data]);
  const member = result?.data;
  const fullName = member && [member.title, member.first_name, member.last_name].filter(Boolean).join(' ');
  return (
    <section className="church-directory" aria-label="Member details">
      <Link className="role-home-link church-directory-back" to={{ pathname: directory, search }}><ArrowLeft size={18} aria-hidden="true" /> Back to members</Link>
      {!result && <PageSkeleton />}
      {result?.error && <Alert type="error" message={result.error} />}
      {member && (
        <article className="church-member-card" aria-labelledby="church-member-name">
          <h1 className="display" id="church-member-name" tabIndex={-1} ref={heading}>{fullName}</h1>
          {member.status && <StatusBadge status={member.status} />}
          <dl>
            {fields.filter(([, field]) => member[field]).map(([label, field]) => (
              <div key={field}><dt>{label}</dt><dd>{member[field]}</dd></div>
            ))}
          </dl>
        </article>
      )}
    </section>
  );
}

export default function ChurchMembers() {
  const { memberId } = useParams();
  return memberId ? <MemberDetails memberId={memberId} /> : <MemberList />;
}
