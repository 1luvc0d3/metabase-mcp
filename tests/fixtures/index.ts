/**
 * Test Fixtures
 * Sample data for integration tests
 */

import type {
  Dashboard,
  Card,
  Database,
  Collection,
  QueryResult,
  DatabaseMetadata,
} from '../../src/client/types.js';

// Sample dashboards
export const sampleDashboards: Dashboard[] = [
  {
    id: 1,
    name: 'Sales Overview',
    description: 'Key sales metrics and KPIs',
    collection_id: 1,
    creator_id: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
    archived: false,
    dashcards: [
      {
        id: 1,
        card_id: 1,
        dashboard_id: 1,
        size_x: 6,
        size_y: 4,
        row: 0,
        col: 0,
      },
      {
        id: 2,
        card_id: 2,
        dashboard_id: 1,
        size_x: 6,
        size_y: 4,
        row: 0,
        col: 6,
      },
    ],
  },
  {
    id: 2,
    name: 'User Analytics',
    description: 'User engagement and retention metrics',
    collection_id: 1,
    creator_id: 1,
    created_at: '2024-01-05T00:00:00Z',
    updated_at: '2024-01-20T00:00:00Z',
    archived: false,
  },
  {
    id: 3,
    name: 'Archived Dashboard',
    description: 'Old dashboard',
    collection_id: null,
    creator_id: 2,
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-06-01T00:00:00Z',
    archived: true,
  },
];

// Sample cards/questions
export const sampleCards: Card[] = [
  {
    id: 1,
    name: 'Monthly Revenue',
    description: 'Total revenue by month',
    display: 'line',
    collection_id: 1,
    creator_id: 1,
    database_id: 1,
    dataset_query: {
      type: 'native',
      database: 1,
      native: {
        query: `SELECT date_trunc('month', created_at) as month, SUM(total) as revenue
                FROM orders GROUP BY 1 ORDER BY 1`,
      },
    },
    visualization_settings: {
      'graph.x_axis.scale': 'timeseries',
    },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
    archived: false,
  },
  {
    id: 2,
    name: 'Active Users Count',
    description: 'Count of active users',
    display: 'scalar',
    collection_id: 1,
    creator_id: 1,
    database_id: 1,
    dataset_query: {
      type: 'native',
      database: 1,
      native: {
        query: 'SELECT COUNT(*) FROM users WHERE active = true',
      },
    },
    visualization_settings: {},
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-16T00:00:00Z',
    archived: false,
  },
  {
    id: 3,
    name: 'Orders by Status',
    description: 'Breakdown of orders by status',
    display: 'pie',
    collection_id: 2,
    creator_id: 2,
    database_id: 1,
    dataset_query: {
      type: 'native',
      database: 1,
      native: {
        query: 'SELECT status, COUNT(*) FROM orders GROUP BY status',
      },
    },
    visualization_settings: {},
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-17T00:00:00Z',
    archived: false,
  },
];

// Sample databases
export const sampleDatabases: Database[] = [
  {
    id: 1,
    name: 'Production Database',
    description: 'Main production PostgreSQL database',
    engine: 'postgres',
    features: ['basic-aggregations', 'expressions', 'native-query-template-tags'],
    is_sample: false,
    is_saved_questions: false,
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 2,
    name: 'Sample Database',
    description: 'Built-in sample H2 database',
    engine: 'h2',
    features: ['basic-aggregations'],
    is_sample: true,
    is_saved_questions: false,
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
  },
  {
    id: 3,
    name: 'Data Warehouse',
    description: 'Snowflake analytics warehouse',
    engine: 'snowflake',
    features: ['basic-aggregations', 'expressions', 'native-query-template-tags', 'window-functions'],
    is_sample: false,
    is_saved_questions: false,
    created_at: '2023-06-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
  },
];

// Sample collections
export const sampleCollections: Collection[] = [
  {
    id: 1,
    name: 'Analytics',
    description: 'Core analytics dashboards and questions',
    color: '#509EE3',
    archived: false,
    location: '/',
    personal_owner_id: null,
  },
  {
    id: 2,
    name: 'Marketing',
    description: 'Marketing team reports',
    color: '#88BF4D',
    archived: false,
    location: '/',
    personal_owner_id: null,
  },
  {
    id: 3,
    name: 'Archive',
    description: 'Archived content',
    color: '#98A0A0',
    archived: true,
    location: '/',
    personal_owner_id: null,
  },
];

// Sample database metadata
export const sampleDatabaseMetadata: DatabaseMetadata = {
  id: 1,
  name: 'Production Database',
  tables: [
    {
      id: 1,
      name: 'users',
      display_name: 'Users',
      description: 'User accounts and profiles',
      schema: 'public',
      fields: [
        { id: 1, name: 'id', display_name: 'ID', description: 'Primary key', base_type: 'type/Integer', semantic_type: 'type/PK', fk_target_field_id: null },
        { id: 2, name: 'email', display_name: 'Email', description: 'User email address', base_type: 'type/Text', semantic_type: 'type/Email', fk_target_field_id: null },
        { id: 3, name: 'name', display_name: 'Name', description: 'Full name', base_type: 'type/Text', semantic_type: 'type/Name', fk_target_field_id: null },
        { id: 4, name: 'active', display_name: 'Active', description: 'Is user active', base_type: 'type/Boolean', semantic_type: null, fk_target_field_id: null },
        { id: 5, name: 'created_at', display_name: 'Created At', description: 'Account creation timestamp', base_type: 'type/DateTime', semantic_type: 'type/CreationTimestamp', fk_target_field_id: null },
      ],
    },
    {
      id: 2,
      name: 'orders',
      display_name: 'Orders',
      description: 'Customer orders',
      schema: 'public',
      fields: [
        { id: 6, name: 'id', display_name: 'ID', description: 'Primary key', base_type: 'type/Integer', semantic_type: 'type/PK', fk_target_field_id: null },
        { id: 7, name: 'user_id', display_name: 'User ID', description: 'Customer who placed order', base_type: 'type/Integer', semantic_type: 'type/FK', fk_target_field_id: 1 },
        { id: 8, name: 'total', display_name: 'Total', description: 'Order total amount', base_type: 'type/Decimal', semantic_type: 'type/Currency', fk_target_field_id: null },
        { id: 9, name: 'status', display_name: 'Status', description: 'Order status', base_type: 'type/Text', semantic_type: 'type/Category', fk_target_field_id: null },
        { id: 10, name: 'created_at', display_name: 'Created At', description: 'Order timestamp', base_type: 'type/DateTime', semantic_type: 'type/CreationTimestamp', fk_target_field_id: null },
      ],
    },
    {
      id: 3,
      name: 'products',
      display_name: 'Products',
      description: 'Product catalog',
      schema: 'public',
      fields: [
        { id: 11, name: 'id', display_name: 'ID', description: 'Primary key', base_type: 'type/Integer', semantic_type: 'type/PK', fk_target_field_id: null },
        { id: 12, name: 'name', display_name: 'Name', description: 'Product name', base_type: 'type/Text', semantic_type: 'type/Name', fk_target_field_id: null },
        { id: 13, name: 'price', display_name: 'Price', description: 'Unit price', base_type: 'type/Decimal', semantic_type: 'type/Currency', fk_target_field_id: null },
        { id: 14, name: 'category', display_name: 'Category', description: 'Product category', base_type: 'type/Text', semantic_type: 'type/Category', fk_target_field_id: null },
      ],
    },
  ],
};

// Sample query result
export const sampleQueryResult: QueryResult = {
  data: {
    rows: [
      [1, 'john@example.com', 'John Doe', true, '2024-01-01T00:00:00Z'],
      [2, 'jane@example.com', 'Jane Smith', true, '2024-01-02T00:00:00Z'],
      [3, 'bob@example.com', 'Bob Wilson', false, '2024-01-03T00:00:00Z'],
    ],
    cols: [
      { name: 'id', display_name: 'ID', base_type: 'type/Integer', semantic_type: 'type/PK' },
      { name: 'email', display_name: 'Email', base_type: 'type/Text', semantic_type: 'type/Email' },
      { name: 'name', display_name: 'Name', base_type: 'type/Text', semantic_type: 'type/Name' },
      { name: 'active', display_name: 'Active', base_type: 'type/Boolean', semantic_type: null },
      { name: 'created_at', display_name: 'Created At', base_type: 'type/DateTime', semantic_type: 'type/CreationTimestamp' },
    ],
  },
  database_id: 1,
  started_at: '2024-01-20T10:00:00Z',
  json_query: {
    type: 'native',
    database: 1,
    native: { query: 'SELECT * FROM users LIMIT 3' },
  },
  average_execution_time: 50,
  status: 'completed',
  context: 'ad-hoc',
  row_count: 3,
  running_time: 45,
};

// Large query result for pagination testing
export const largeQueryResult: QueryResult = {
  data: {
    rows: Array.from({ length: 15000 }, (_, i) => [i + 1, `user${i}@example.com`, `User ${i}`]),
    cols: [
      { name: 'id', display_name: 'ID', base_type: 'type/Integer', semantic_type: 'type/PK' },
      { name: 'email', display_name: 'Email', base_type: 'type/Text', semantic_type: 'type/Email' },
      { name: 'name', display_name: 'Name', base_type: 'type/Text', semantic_type: 'type/Name' },
    ],
  },
  database_id: 1,
  started_at: '2024-01-20T10:00:00Z',
  json_query: {
    type: 'native',
    database: 1,
    native: { query: 'SELECT * FROM users' },
  },
  average_execution_time: 500,
  status: 'completed',
  context: 'ad-hoc',
  row_count: 15000,
  running_time: 480,
};
