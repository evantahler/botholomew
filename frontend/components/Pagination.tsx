import React from "react";
import { Pagination as BootstrapPagination } from "react-bootstrap";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  currentOffset: number;
  onPageChange: (page: number) => void;
  showInfo?: boolean;
}

export default function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  currentOffset,
  onPageChange,
  showInfo = true,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const startItem = currentOffset + 1;
  const endItem = Math.min(currentOffset + itemsPerPage, totalItems);

  return (
    <div className="d-flex justify-content-between align-items-center">
      {showInfo && (
        <div className="text-muted">
          Showing {startItem} to {endItem} of {totalItems} items
        </div>
      )}
      <BootstrapPagination>
        <BootstrapPagination.First
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
        />
        <BootstrapPagination.Prev
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
        />

        {/* Show first page */}
        {currentPage > 3 && (
          <>
            <BootstrapPagination.Item onClick={() => onPageChange(1)}>
              1
            </BootstrapPagination.Item>
            {currentPage > 4 && <BootstrapPagination.Ellipsis />}
          </>
        )}

        {/* Show pages around current page */}
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          const page = Math.max(1, Math.min(totalPages, currentPage - 2 + i));
          if (page < 1 || page > totalPages) return null;

          return (
            <BootstrapPagination.Item
              key={page}
              active={page === currentPage}
              onClick={() => onPageChange(page)}
            >
              {page}
            </BootstrapPagination.Item>
          );
        })}

        {/* Show last page */}
        {currentPage < totalPages - 2 && (
          <>
            {currentPage < totalPages - 3 && <BootstrapPagination.Ellipsis />}
            <BootstrapPagination.Item onClick={() => onPageChange(totalPages)}>
              {totalPages}
            </BootstrapPagination.Item>
          </>
        )}

        <BootstrapPagination.Next
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
        />
        <BootstrapPagination.Last
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
        />
      </BootstrapPagination>
    </div>
  );
}
