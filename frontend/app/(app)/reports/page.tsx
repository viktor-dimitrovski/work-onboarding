'use client';

import { useEffect, useMemo, useState } from 'react';

import { LoadingState } from '@/components/common/loading-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type {
  AdminDashboardReport,
  EmployeeDashboardReport,
  MentorDashboardReport,
} from '@/lib/types';

export default function ReportsPage() {
  const { accessToken, user } = useAuth();

  const [adminData, setAdminData] = useState<AdminDashboardReport | null>(null);
  const [employeeData, setEmployeeData] = useState<EmployeeDashboardReport | null>(null);
  const [mentorData, setMentorData] = useState<MentorDashboardReport | null>(null);
  const [loading, setLoading] = useState(true);

  const roleSet = useMemo(() => new Set(user?.roles ?? []), [user?.roles]);

  useEffect(() => {
    const run = async () => {
      if (!accessToken) return;
      setLoading(true);
      try {
        if (roleSet.has('super_admin') || roleSet.has('admin') || roleSet.has('hr_viewer')) {
          setAdminData(await api.get<AdminDashboardReport>('/reports/admin-dashboard', accessToken));
        }
        if (roleSet.has('mentor')) {
          setMentorData(await api.get<MentorDashboardReport>('/reports/mentor-dashboard', accessToken));
        }
        if (roleSet.has('employee')) {
          setEmployeeData(await api.get<EmployeeDashboardReport>('/reports/employee-dashboard', accessToken));
        }
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [accessToken, roleSet]);

  if (loading) return <LoadingState label='Loading reports...' />;

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Reports</h2>
        <p className='text-sm text-muted-foreground'>Operational reporting by role scope.</p>
      </div>

      {adminData && (
        <section className='space-y-3'>
          <h3 className='text-lg font-semibold'>Admin and HR summary</h3>
          <div className='grid gap-3 md:grid-cols-4'>
            <Metric title='Active onboardings' value={String(adminData.active_onboardings)} />
            <Metric title='Completion rate' value={`${adminData.completion_rate_percent.toFixed(1)}%`} />
            <Metric title='Overdue tasks' value={String(adminData.overdue_tasks)} />
            <Metric title='Mentor queue' value={String(adminData.mentor_approval_queue)} />
          </div>
        </section>
      )}

      {mentorData && (
        <section className='space-y-3'>
          <h3 className='text-lg font-semibold'>Mentor summary</h3>
          <div className='grid gap-3 md:grid-cols-3'>
            <Metric title='Mentees' value={String(mentorData.mentee_count)} />
            <Metric title='Pending reviews' value={String(mentorData.pending_reviews)} />
            <Metric title='Recent feedback' value={String(mentorData.recent_feedback)} />
          </div>
        </section>
      )}

      {employeeData && (
        <section className='space-y-3'>
          <h3 className='text-lg font-semibold'>Employee summary</h3>
          <div className='grid gap-3 md:grid-cols-5'>
            <Metric title='Assignments' value={String(employeeData.assignment_count)} />
            <Metric title='Current phase' value={employeeData.current_phase || 'N/A'} />
            <Metric title='Upcoming tasks' value={String(employeeData.upcoming_tasks)} />
            <Metric title='Overdue tasks' value={String(employeeData.overdue_tasks)} />
            <Metric title='Avg progress' value={`${employeeData.average_progress_percent.toFixed(1)}%`} />
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <CardTitle className='text-2xl'>{value}</CardTitle>
      </CardContent>
    </Card>
  );
}
