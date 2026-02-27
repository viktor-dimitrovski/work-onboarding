'use client';

import Link from 'next/link';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const items = [
  {
    title: 'Question Bank',
    description: 'Create and manage reusable assessment questions.',
    href: '/assessments/questions',
  },
  {
    title: 'Tests',
    description: 'Build assessments with versioned question sets.',
    href: '/assessments/tests',
  },
  {
    title: 'Deliveries',
    description: 'Assign tests to employees or run campaigns.',
    href: '/assessments/deliveries',
  },
  {
    title: 'Results',
    description: 'Review attempts, scores, and trends.',
    href: '/assessments/results',
  },
];

export default function AssessmentsPage() {
  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-2xl font-semibold'>Assessments</h2>
        <p className='text-sm text-muted-foreground'>Knowledge testing across roles and topics.</p>
      </div>
      <div className='grid gap-4 md:grid-cols-2'>
        {items.map((item) => (
          <Card key={item.href}>
            <CardHeader>
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant='outline' asChild>
                <Link href={item.href}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
