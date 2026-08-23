'use client';

/**
 * The mobile menu.
 *
 * Below md the sidebar is gone and this takes its place: four groups across the
 * bottom, the rest behind More. It reads the SAME list the sidebar reads
 * (`navGroups`) and filters it through the SAME rule (`visibleNavGroups`), so a
 * page added to one menu appears in the other, and a page a member may not open
 * is missing from both.
 */

import { useMemo, useCallback, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  BookOpen,
  RefreshCw,
  ShoppingCart,
  Newspaper,
  BarChart3,
  Layers,
  MoreHorizontal,
  LucideIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLibraryRole } from '@/hooks/use-library-role';
import { useBottomNav, useBottomNavHydration } from '@/hooks/use-bottom-nav';
import { visibleNavGroups } from '@/components/layout/lib-sidebar';
import { BottomNavItem } from './bottom-nav-item';
import { BottomNavSubmenu } from './bottom-nav-submenu';
import { BottomNavMoreMenu } from './bottom-nav-more-menu';
import { BottomNavGroup, FlatMenuItem } from './types';

/** One icon per sidebar group, for the bar and the More sheet. */
const GROUP_ICONS: Record<string, LucideIcon> = {
  'Overview': LayoutDashboard,
  'Knowledge Registry': BookOpen,
  'Circulation': RefreshCw,
  'Acquisition': ShoppingCart,
  'Periodicals': Newspaper,
  'Other': Layers,
  'Reports': BarChart3
};

/** Group order decides what sits in the bar; the rest go behind More. */
const PRIMARY_COUNT = 4;

function groupId(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Dashboard lives at '/', which every path starts with, so it would light up
 * on every page. It is matched exactly; everything else also matches its
 * children (/registry/123 belongs to /registry).
 */
function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function BottomNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { role, isMember, isReady, pages } = useLibraryRole();
  const hasHydrated = useBottomNavHydration();

  const {
    activeNavId,
    isExpanded,
    isMoreMenuOpen,
    setActiveNav,
    switchToNav,
    setExpanded,
    setMoreMenuOpen
  } = useBottomNav();

  // The sidebar's own groups, filtered by the sidebar's own rule
  const allNavGroups = useMemo((): BottomNavGroup[] => {
    return visibleNavGroups(role, isMember, pages).map(group => ({
      id: groupId(group.label),
      groupLabel: group.label,
      icon: GROUP_ICONS[group.label] ?? Layers,
      menus: group.items.map((item): FlatMenuItem => ({
        href: item.url,
        label: item.title,
        icon: item.icon as LucideIcon,
        active: isActivePath(pathname, item.url)
      }))
    }));
  }, [role, isMember, pages, pathname]);

  const primaryNavGroups = useMemo(() => allNavGroups.slice(0, PRIMARY_COUNT), [allNavGroups]);
  const moreNavGroups = useMemo(() => allNavGroups.slice(PRIMARY_COUNT), [allNavGroups]);

  // Which group the page you are on belongs to. The longest matching href wins,
  // so /circulation/holds picks Holds and not the Circulation Desk above it.
  const currentActiveGroup = useMemo(() => {
    let best: { group: BottomNavGroup; length: number } | null = null;
    for (const group of allNavGroups) {
      for (const menu of group.menus) {
        if (isActivePath(pathname, menu.href) && (!best || menu.href.length > best.length)) {
          best = { group, length: menu.href.length };
        }
      }
    }
    return best?.group ?? null;
  }, [pathname, allNavGroups]);

  // While a submenu is open the highlight follows what the finger picked;
  // otherwise it follows the page you are actually on.
  const effectiveActiveNavId = useMemo(() => {
    if (isExpanded && activeNavId) return activeNavId;
    return currentActiveGroup?.id ?? activeNavId;
  }, [isExpanded, activeNavId, currentActiveGroup]);

  const activeSubmenus = useMemo(() => {
    const selected = allNavGroups.find(g => g.id === effectiveActiveNavId);
    return selected?.menus ?? currentActiveGroup?.menus ?? [];
  }, [effectiveActiveNavId, allNavGroups, currentActiveGroup]);

  // Follow the page while nothing is open — but never fight a finger
  useEffect(() => {
    if (!isExpanded && currentActiveGroup && currentActiveGroup.id !== activeNavId) {
      setActiveNav(currentActiveGroup.id);
    }
  }, [currentActiveGroup, activeNavId, isExpanded, setActiveNav]);

  const handleNavClick = useCallback(
    (group: BottomNavGroup) => {
      // A group holding one page has nothing to expand — just go there
      if (group.menus.length === 1) {
        setExpanded(false);
        setMoreMenuOpen(false);
        setActiveNav(group.id);
        router.push(group.menus[0].href);
        return;
      }
      if (isExpanded && activeNavId === group.id) {
        setExpanded(false);
        setMoreMenuOpen(false);
      } else {
        switchToNav(group.id);
      }
    },
    [isExpanded, activeNavId, switchToNav, setExpanded, setMoreMenuOpen, setActiveNav, router]
  );

  const handleSubmenuClick = useCallback(
    (href: string) => {
      router.push(href);
      setExpanded(false);
    },
    [router, setExpanded]
  );

  const handleMoreClick = useCallback(() => {
    setExpanded(false);
    setMoreMenuOpen(!isMoreMenuOpen);
  }, [setExpanded, setMoreMenuOpen, isMoreMenuOpen]);

  const handleMoreItemClick = useCallback(
    (href: string) => {
      router.push(href);
      setMoreMenuOpen(false);
    },
    [router, setMoreMenuOpen]
  );

  // A tap outside closes the submenu
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-bottom-nav]')) setExpanded(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isExpanded, setExpanded]);

  // Nothing until the stored state and the role are both known, so the bar
  // cannot flash the wrong menu at someone
  if (!hasHydrated || !isReady) return null;
  if (primaryNavGroups.length === 0) return null;

  return (
    <>
      {/* Backdrop behind an open submenu */}
      <AnimatePresence>
        {isExpanded && !isMoreMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[75] md:hidden"
            onClick={() => setExpanded(false)}
          />
        )}
      </AnimatePresence>

      <motion.nav
        data-bottom-nav
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
        className={cn(
          'fixed bottom-0 left-0 right-0 z-[80]',
          // md is exactly where the sidebar comes back, so the two never overlap
          'md:hidden',
          'bg-background border-t border-border',
          'shadow-[0_-4px_20px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.3)]'
        )}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <BottomNavSubmenu
          items={activeSubmenus}
          isOpen={isExpanded}
          onItemClick={handleSubmenuClick}
        />

        <div className="flex items-center justify-around">
          {primaryNavGroups.map(group => (
            <BottomNavItem
              key={group.id}
              id={group.id}
              icon={group.icon}
              label={group.groupLabel}
              isActive={effectiveActiveNavId === group.id}
              hasSubmenu={group.menus.length > 1}
              onClick={() => handleNavClick(group)}
            />
          ))}

          {moreNavGroups.length > 0 && (
            <BottomNavItem
              id="more"
              icon={MoreHorizontal}
              label="More"
              isActive={isMoreMenuOpen}
              hasSubmenu
              badgeCount={moreNavGroups.length}
              onClick={handleMoreClick}
            />
          )}
        </div>
      </motion.nav>

      <BottomNavMoreMenu
        groups={moreNavGroups}
        isOpen={isMoreMenuOpen}
        onClose={() => setMoreMenuOpen(false)}
        onItemClick={handleMoreItemClick}
      />
    </>
  );
}
