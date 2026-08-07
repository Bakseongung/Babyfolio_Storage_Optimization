export type Family = {
  id: string;
  name: string;
  members: { role: "OWNER" | "MEMBER" }[];
  albums: Album[];
};

export type FamilyMember = {
  id: string;
  role: "OWNER" | "MEMBER";
  createdAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
};

export type Album = {
  id: string;
  familyId: string;
  name: string;
  childTags: ChildTag[];
};

export type ChildTag = {
  id: string;
  albumId: string;
  name: string;
};

export type CalendarDay = {
  date: string;
  count: number;
  representativeMediaId: string | null;
};

export type Media = {
  id: string;
  albumDate: string;
  originalName: string;
  uploadedById: string;
  createdAt: string;
  mediaAsset: { width: number; height: number; mimeType?: string };
  childTags: ChildTag[];
};

export type MediaFeedPage = {
  items: Media[];
  nextCursor: string | null;
};
