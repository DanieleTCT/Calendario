import { Router, Request, Response } from 'express';
import { CalendarItem, ValidationError } from '@calendario/domain';
import { v4 as uuid } from 'uuid';

export const itemRoutes = Router();

itemRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const { category, type, startDate, endDate } = req.query;
    const repository = req.appContext!.repository;

    let items = await repository.listItems();

    // Filter
    if (category) {
      items = items.filter((item) => item.category === category);
    }
    if (type) {
      items = items.filter((item) => item.type === type);
    }
    if (startDate && endDate) {
      items = items.filter(
        (item) => item.date >= startDate && item.date <= endDate
      );
    }

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

itemRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const repository = req.appContext!.repository;
    const { type, title, date, description, startTime, endTime, allDay, category, recurrence } = req.body;

    if (!type || !title || !date) {
      return res.status(400).json({ error: 'Missing required fields: type, title, date' });
    }

    if (!['event', 'task'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type. Must be "event" or "task"' });
    }

    const item: CalendarItem = {
      id: uuid(),
      type,
      title,
      date,
      description,
      startTime,
      endTime,
      allDay: allDay || false,
      category: category || 'general',
      recurrence: recurrence || 'none',
      visibility: 'default',
      completed: type === 'task' ? false : undefined,
      reminderMinutes: 1440,
      source: 'local',
      createdAt: new Date().toISOString(),
    };

    const created = await repository.createItem(item);
    res.status(201).json(created);
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: String(error) });
  }
});

itemRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const repository = req.appContext!.repository;

    const item = await repository.getItem(id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

itemRoutes.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const repository = req.appContext!.repository;
    const updates = req.body;

    const updated = await repository.updateItem(id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: String(error) });
  }
});

itemRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const repository = req.appContext!.repository;

    const deleted = await repository.deleteItem(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
